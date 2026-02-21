import type { DiscoveryJobInput, JobResult } from '../types/jobs.js';
import { pool } from '../config/database.js';
import { resolveDataset, markDatasetRefreshed } from './datasetResolver.js';
import { randomUUID } from 'crypto';
import { enforceDiscoveryLimits, type UserPlan } from '../limits/enforcePlanLimits.js';
import { checkUsageLimit } from '../limits/usageLimits.js';
import { getUserPermissions, checkPermission } from '../db/permissions.js';
import { getUserUsage, incrementUsage } from '../persistence/index.js';
import { logDiscoveryAction } from '../utils/actionLogger.js';
import { createDiscoveryRun, updateDiscoveryRun } from '../db/discoveryRuns.js';
import { enforceDatasetCreation } from './enforcementService.js';

/**
 * Run a discovery job
 * This is for ad-hoc, paid discovery requests
 * Uses geo-grid discovery and creates new businesses
 */
export async function runDiscoveryJob(input: DiscoveryJobInput): Promise<JobResult> {
  console.log(`\n[runDiscoveryJob] ===== RUN DISCOVERY JOB CALLED =====`);
  console.log(`[runDiscoveryJob] Input:`, JSON.stringify(input, null, 2));
  
  const startTime = new Date();
  const jobId = `discovery-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const errors: string[] = [];

    console.log(`\n🔍 Starting DISCOVERY job: ${jobId}`);
    console.log(`   Industry: ${input.industry_id || input.industry}`);
    console.log(`   City: ${input.city_id || input.city}`);
    console.log(`   Discovery method: GEMI API (official Greek business registry)`);

  let discoveryRun: Awaited<ReturnType<typeof createDiscoveryRun>> | undefined;
  
  try {
    // Resolve dataset with reuse logic (backend-only)
    // If datasetId is provided, use it directly (for explicit selection)
    // Otherwise, resolve or create dataset based on city + industry
    let datasetId: string;
    let isReused = false;
    let isInternalUser = false; // Declare at function scope

    if (input.datasetId) {
      // Explicit dataset ID provided - use it directly
      datasetId = input.datasetId;
      console.log(`[runDiscoveryJob] Using provided dataset: ${datasetId}`);
    } else {
      // Resolve dataset with reuse logic
      if (!input.userId) {
        throw new Error('User ID is required when dataset ID is not provided');
      }
      if (!input.city || !input.industry) {
        throw new Error('City and industry are required when dataset ID is not provided');
      }

      // Get user permissions from database (source of truth: Stripe subscription)
      // Never trust client payload - always query database
      const permissions = await getUserPermissions(input.userId);
      const userPlan = permissions.plan;

      // Check monthly usage limit for dataset creation (only if creating new)
      // Internal users bypass usage limits
      isInternalUser = permissions.is_internal_user || false; // Server-side only
      const usage = await getUserUsage(input.userId);
      const usageCheck = checkUsageLimit(userPlan, 'dataset', usage.datasets_created_this_month, isInternalUser);
      
      if (!usageCheck.allowed) {
        // Return error with usage limit info
        errors.push(usageCheck.reason || 'Dataset creation limit reached');
        return {
          jobId,
          jobType: 'discovery',
          startTime,
          endTime: new Date(),
          totalWebsitesProcessed: 0,
          contactsAdded: 0,
          contactsRemoved: 0,
          contactsVerified: 0,
          errors: [...errors],
          gated: true,
          upgrade_hint: usageCheck.upgrade_hint,
        };
      }

      // Enforce dataset creation limit before resolving
      await enforceDatasetCreation(input.userId);

      // Get municipality name for dataset naming (prefer municipality name over city name)
      let municipalityName: string | undefined;
      if (input.municipality_id) {
        const municipalityResult = await pool.query<{ descr: string; descr_en: string }>(
          'SELECT descr, descr_en FROM municipalities WHERE id = $1',
          [input.municipality_id]
        );
        if (municipalityResult.rows.length > 0) {
          // Prefer Greek name (descr), fallback to English (descr_en)
          municipalityName = municipalityResult.rows[0].descr || municipalityResult.rows[0].descr_en;
        }
      } else if (input.municipality_gemi_id) {
        const municipalityResult = await pool.query<{ descr: string; descr_en: string }>(
          'SELECT descr, descr_en FROM municipalities WHERE gemi_id = $1',
          [input.municipality_gemi_id.toString()]
        );
        if (municipalityResult.rows.length > 0) {
          municipalityName = municipalityResult.rows[0].descr || municipalityResult.rows[0].descr_en;
        }
      }

      // Resolve dataset - prefer IDs, fallback to names (must exist, won't create)
      const resolverResult = await resolveDataset({
        userId: input.userId,
        cityId: input.city_id, // Use city ID if available
        cityName: input.city_id ? undefined : input.city, // Only use city name if city_id not provided
        industryId: input.industry_id, // Use industry ID if available
        industryName: input.industry_id ? undefined : input.industry, // Only use industry name if industry_id not provided
        municipalityName: municipalityName, // Pass municipality name for better dataset naming
      });

      datasetId = resolverResult.dataset.id;
      isReused = resolverResult.isReused;
      
      // Increment usage counter only if new dataset was created
      // Works with DB or local JSON
      if (!isReused && input.userId) {
        await incrementUsage(input.userId, 'dataset');
      }

      if (isReused) {
        console.log(`[runDiscoveryJob] Reusing existing dataset: ${datasetId} (refreshed ${resolverResult.dataset.last_refreshed_at})`);
      } else {
        console.log(`[runDiscoveryJob] Created new dataset: ${datasetId}`);
      }
    }

    // Use provided discovery_run_id or create a new one
    // If discovery_run_id is provided (from endpoint), use it; otherwise create one
    if (input.discoveryRunId) {
      const { getDiscoveryRunById } = await import('../db/discoveryRuns.js');
      const foundRun = await getDiscoveryRunById(input.discoveryRunId);
      if (!foundRun) {
        throw new Error(`Discovery run ${input.discoveryRunId} not found`);
      }
      discoveryRun = foundRun;
      console.log(`[runDiscoveryJob] Using provided discovery_run: ${discoveryRun.id}`);
    } else {
      // Create discovery_run (orchestration layer) - fallback if not provided
      discoveryRun = await createDiscoveryRun(datasetId, input.userId, input.industry_group_id);
      console.log(`[runDiscoveryJob] Created discovery_run: ${discoveryRun.id}`);
    }

    // Check discovery limits using permissions - before discovery
    // Use permissions.max_datasets to check if user can create more datasets
    let isGated = false;
    let upgradeHint: string | undefined;

    // Get permissions if not already retrieved (for explicit datasetId case)
    let permissions: Awaited<ReturnType<typeof getUserPermissions>>;
    let userPlan: 'demo' | 'starter' | 'pro';
    
    if (input.userId) {
      permissions = await getUserPermissions(input.userId);
      userPlan = permissions.plan;
      // Update isInternalUser if not already set
      if (!isInternalUser) {
        isInternalUser = permissions.is_internal_user || false;
      }
    } else {
      // If no userId, default to demo (shouldn't happen in normal flow)
      permissions = await getUserPermissions(''); // Will default to demo
      userPlan = 'demo';
      isInternalUser = false;
    }

    // Count municipalities in this dataset (city_id column removed)
    const municipalitiesResult = await pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT municipality_id) as count
       FROM businesses
       WHERE dataset_id = $1`,
      [datasetId]
    );
    
    const citiesResult = municipalitiesResult; // Keep variable name for compatibility
    const currentCities = parseInt(citiesResult.rows[0]?.count || '0', 10);
    const requestedCities = currentCities + 1; // Adding one more city

    // Check if user has reached max datasets limit
    // Internal users bypass dataset limits
    if (!isInternalUser && permissions.max_datasets !== Number.MAX_SAFE_INTEGER && input.userId) {
      // Count user's datasets
      const datasetsResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM datasets
         WHERE user_id = $1`,
        [input.userId]
      );
      const datasetCount = parseInt(datasetsResult.rows[0]?.count || '0', 10);
      
      if (datasetCount >= permissions.max_datasets) {
        isGated = true;
        upgradeHint = userPlan === 'demo'
          ? 'Upgrade to Starter plan for up to 5 datasets.'
          : userPlan === 'starter'
          ? 'Upgrade to Pro plan for unlimited datasets.'
          : undefined;
        console.log(`[runDiscoveryJob] Discovery gated: User has reached max datasets limit (${datasetCount}/${permissions.max_datasets})`);
      }
    }

    // Mark discovery_run as started (execution truly begins now, before creating extraction_jobs)
    await updateDiscoveryRun(discoveryRun.id, {
      started_at: new Date()
    });
    console.log(`[runDiscoveryJob] Marked discovery_run as started: ${discoveryRun.id}`);

    // Validate required fields for discovery
    // Prefer gemi_id values, fallback to internal IDs
    if (!input.industry_gemi_id && !input.industry_id && !input.industry) {
      throw new Error('industry_gemi_id, industry_id, or industry is required for discovery');
    }
    if (!input.municipality_gemi_id && !input.municipality_id && !input.prefecture_gemi_id && !input.prefecture_id && !input.city_id && !input.city) {
      throw new Error('municipality_gemi_id, municipality_id, prefecture_gemi_id, prefecture_id, city_id, or city is required for discovery');
    }

    // Resolve industry: prefer industry_group_id, then industry_id, fallback to industry name (legacy)
    let finalIndustryId = input.industry_id;
    let finalIndustryGemiId = input.industry_gemi_id;
    let industriesToUse: Array<{ id: string; name: string; discovery_keywords: string[] | null; search_weight: number | null }> = [];
    let industriesInGroup: Array<{ id: string; name: string; discovery_keywords: string[] | null; search_weight: number | null }> = []; // Declare at higher scope for later use

    // Handle industry_group_id: if provided, fetch all industries in the group
    if (input.industry_group_id) {
      const { getIndustriesByGroup } = await import('../db/industryGroups.js');
      industriesInGroup = await getIndustriesByGroup(input.industry_group_id);
      
      if (industriesInGroup.length === 0) {
        throw new Error(`No industries found for industry group ${input.industry_group_id}`);
      }
      
      industriesToUse = industriesInGroup;
      
      // Use the first industry (highest search_weight) for GEMI discovery
      // TODO: In the future, support multiple industry discovery or keyword-based discovery with merged keywords
      const primaryIndustry = industriesInGroup[0];
      finalIndustryId = primaryIndustry.id;
      
      // Try to get gemi_id for the primary industry
      const industryGemiResult = await pool.query<{ gemi_id: number }>(
        'SELECT gemi_id FROM industries WHERE id = $1',
        [finalIndustryId]
      );
      if (industryGemiResult.rows.length > 0 && industryGemiResult.rows[0].gemi_id) {
        finalIndustryGemiId = industryGemiResult.rows[0].gemi_id;
      }
      
      console.log(`[runDiscoveryJob] Using industry group ${input.industry_group_id} with ${industriesInGroup.length} industries`);
      console.log(`[runDiscoveryJob] Primary industry for GEMI: ${primaryIndustry.name} (${finalIndustryId})`);
      console.log(`[runDiscoveryJob] All industries in group: ${industriesInGroup.map(i => `${i.name} (weight: ${i.search_weight || 'null'})`).join(', ')}`);
      
      // Merge all discovery_keywords from industries in the group
      const allKeywords = [
        ...new Set(
          industriesInGroup.flatMap(i => i.discovery_keywords || [])
        )
      ];
      console.log(`[runDiscoveryJob] Merged keywords from group: ${allKeywords.join(', ')}`);
      // TODO: Use merged keywords for keyword-based discovery in the future
    } else {
      // Resolve industry_id from industry_gemi_id if needed
      if (input.industry_gemi_id && !finalIndustryId) {
        const industryResult = await pool.query<{ id: string; gemi_id: number }>(
          'SELECT id, gemi_id FROM industries WHERE gemi_id = $1',
          [input.industry_gemi_id]
        );
        if (industryResult.rows.length === 0) {
          throw new Error(`Industry with gemi_id ${input.industry_gemi_id} not found`);
        }
        finalIndustryId = industryResult.rows[0].id;
        finalIndustryGemiId = industryResult.rows[0].gemi_id;
        console.log(`[runDiscoveryJob] Resolved industry_gemi_id ${input.industry_gemi_id} to industry_id ${finalIndustryId}`);
      } else if (finalIndustryId && !finalIndustryGemiId) {
        // Get gemi_id from industry_id
        const industryResult = await pool.query<{ gemi_id: number }>(
          'SELECT gemi_id FROM industries WHERE id = $1',
          [finalIndustryId]
        );
        if (industryResult.rows.length > 0) {
          finalIndustryGemiId = industryResult.rows[0].gemi_id;
        }
      }

      if (!finalIndustryId && input.industry) {
        const { getIndustryByName } = await import('../db/industries.js');
        const industry = await getIndustryByName(input.industry);
        if (!industry) {
          throw new Error(`Industry "${input.industry}" not found`);
        }
        finalIndustryId = industry.id;
      }
      
      // For single industry, use it as the only industry
      if (finalIndustryId) {
        const { getIndustryById } = await import('../db/industries.js');
        const industry = await getIndustryById(finalIndustryId);
        if (industry) {
          industriesToUse = [industry];
        }
      }
    }

    // Resolve municipality_id from municipality_gemi_id if needed
    let finalMunicipalityId = input.municipality_id;
    let finalMunicipalityGemiId = input.municipality_gemi_id;
    
    // Resolve prefecture_id and prefecture_gemi_id
    let finalPrefectureId = input.prefecture_id;
    let finalPrefectureGemiId = input.prefecture_gemi_id;

    // Resolve municipality_id from municipality_gemi_id if needed (city_id column removed)
    if (input.municipality_gemi_id && !finalMunicipalityId) {
      const municipalityResult = await pool.query<{ id: string; gemi_id: string; prefecture_id: string }>(
        'SELECT id, gemi_id, prefecture_id FROM municipalities WHERE gemi_id = $1',
        [input.municipality_gemi_id.toString()]
      );
      if (municipalityResult.rows.length === 0) {
        throw new Error(`Municipality with gemi_id ${input.municipality_gemi_id} not found`);
      }
      finalMunicipalityId = municipalityResult.rows[0].id;
      finalMunicipalityGemiId = parseInt(municipalityResult.rows[0].gemi_id, 10);
      // Also set prefecture_id if not already set
      if (!finalPrefectureId) {
        finalPrefectureId = municipalityResult.rows[0].prefecture_id;
      }
      console.log(`[runDiscoveryJob] Resolved municipality_gemi_id ${input.municipality_gemi_id} to municipality_id ${finalMunicipalityId}`);
    } else if (finalMunicipalityId && !finalMunicipalityGemiId) {
      // Get gemi_id from municipality_id
      const municipalityResult = await pool.query<{ gemi_id: string; prefecture_id: string }>(
        'SELECT gemi_id, prefecture_id FROM municipalities WHERE id = $1',
        [finalMunicipalityId]
      );
      if (municipalityResult.rows.length > 0) {
        finalMunicipalityGemiId = parseInt(municipalityResult.rows[0].gemi_id, 10);
        // Also set prefecture_id if not already set
        if (!finalPrefectureId) {
          finalPrefectureId = municipalityResult.rows[0].prefecture_id;
        }
      }
    }
    
    // Resolve prefecture_gemi_id from prefecture_id if needed
    if (finalPrefectureId && !finalPrefectureGemiId) {
      const prefectureResult = await pool.query<{ gemi_id: string }>(
        'SELECT gemi_id FROM prefectures WHERE id = $1',
        [finalPrefectureId]
      );
      if (prefectureResult.rows.length > 0) {
        finalPrefectureGemiId = parseInt(prefectureResult.rows[0].gemi_id, 10);
        console.log(`[runDiscoveryJob] Resolved prefecture_id ${finalPrefectureId} to prefecture_gemi_id ${finalPrefectureGemiId}`);
      }
    } else if (input.prefecture_gemi_id && !finalPrefectureGemiId) {
      finalPrefectureGemiId = input.prefecture_gemi_id;
    }

    if (!finalIndustryId) {
      throw new Error('Could not resolve industry_id');
    }
    
    // Need either municipality or prefecture for GEMI discovery
    if (!finalMunicipalityGemiId && !finalMunicipalityId && !finalPrefectureGemiId && !finalPrefectureId) {
      throw new Error('Could not resolve municipality_gemi_id, municipality_id, prefecture_gemi_id, or prefecture_id');
    }

    // STEP 1: Check local database first for existing businesses
    // Check for businesses matching the criteria (municipality/prefecture) regardless of dataset_id
    // This allows us to find businesses created in previous discovery runs and link them to this dataset
    console.log(`[runDiscoveryJob] Checking local database for existing businesses...`);
    let existingBusinessesResult;
    if (finalMunicipalityId) {
      existingBusinessesResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM businesses
         WHERE municipality_id = $1`,
        [finalMunicipalityId]
      );
    } else if (finalMunicipalityGemiId) {
      // Check by municipality GEMI ID
      const municipalityGemiIds = Array.isArray(finalMunicipalityGemiId) 
        ? finalMunicipalityGemiId 
        : [finalMunicipalityGemiId];
      existingBusinessesResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM businesses
         WHERE municipality_id IN (
           SELECT id FROM municipalities WHERE gemi_id = ANY($1::text[])
         )`,
        [municipalityGemiIds.map(String)]
      );
    } else if (finalPrefectureId) {
      // When only prefecture is available, check by prefecture_id
      existingBusinessesResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM businesses
         WHERE prefecture_id = $1`,
        [finalPrefectureId]
      );
    } else if (finalPrefectureGemiId) {
      // Check by prefecture GEMI ID
      existingBusinessesResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM businesses
         WHERE prefecture_id IN (
           SELECT id FROM prefectures WHERE gemi_id = $1
         )`,
        [String(finalPrefectureGemiId)]
      );
    } else {
      // Fallback: can't check without location criteria
      existingBusinessesResult = { rows: [{ count: '0' }] };
    }
    
    const existingCount = parseInt(existingBusinessesResult.rows[0]?.count || '0', 10);
    console.log(`[runDiscoveryJob] Found ${existingCount} existing businesses in local database`);

    let discoveryResult: {
      businessesFound: number;
      businessesCreated: number;
      businessesUpdated: number;
      searchesExecuted: number;
      errors: string[];
    } = {
      businessesFound: 0,
      businessesCreated: 0,
      businessesUpdated: 0,
      searchesExecuted: 0,
      errors: [],
    };

    // STEP 2: If no results found, fetch from GEMI API
    if (existingCount === 0) {
      console.log(`[runDiscoveryJob] No existing businesses found, fetching from GEMI API...`);
      
      let municipalityGemiId: number[] | undefined;
      let prefectureGemiId: number | undefined;
      
      // Use municipality_gemi_id directly if available (preferred)
      // Always send as array, even for single municipality
      if (finalMunicipalityGemiId) {
        municipalityGemiId = Array.isArray(finalMunicipalityGemiId) ? finalMunicipalityGemiId : [finalMunicipalityGemiId];
        console.log(`[runDiscoveryJob] Using municipality_gemi_id directly: [${municipalityGemiId.join(', ')}]`);
      } else if (finalMunicipalityId) {
        // Fallback: get gemi_id from municipality_id
        const municipalityResult = await pool.query<{ gemi_id: string }>(
          `SELECT gemi_id FROM municipalities 
           WHERE id = $1 OR gemi_id = $2`,
          [finalMunicipalityId, finalMunicipalityId.replace('mun-', '')]
        );
        
        if (municipalityResult.rows.length === 0) {
          throw new Error(`Municipality with id ${finalMunicipalityId} not found`);
        }
        
        // Always send as array, even for single municipality
        municipalityGemiId = [parseInt(municipalityResult.rows[0].gemi_id, 10)];
        console.log(`[runDiscoveryJob] Resolved municipality_id to gemi_id: [${municipalityGemiId.join(', ')}]`);
      } else if (finalPrefectureGemiId || finalPrefectureId) {
        // When prefecture is selected but no municipalities are provided,
        // ENHANCEMENT: Fetch ALL municipalities in the prefecture for maximum results
        if (!finalPrefectureGemiId && finalPrefectureId) {
          const prefectureResult = await pool.query<{ gemi_id: string }>(
            'SELECT gemi_id FROM prefectures WHERE id = $1',
            [finalPrefectureId]
          );
          if (prefectureResult.rows.length > 0) {
            finalPrefectureGemiId = parseInt(prefectureResult.rows[0].gemi_id, 10);
          }
        }
        
        if (finalPrefectureGemiId || finalPrefectureId) {
          // Fetch all municipalities in this prefecture for maximum coverage
          const prefectureIdForQuery = finalPrefectureId || (await pool.query<{ id: string }>(
            'SELECT id FROM prefectures WHERE gemi_id = $1',
            [String(finalPrefectureGemiId)]
          )).rows[0]?.id;
          
          if (prefectureIdForQuery) {
            const municipalitiesResult = await pool.query<{ gemi_id: string }>(
              'SELECT gemi_id FROM municipalities WHERE prefecture_id = $1 AND gemi_id IS NOT NULL',
              [prefectureIdForQuery]
            );
            
            if (municipalitiesResult.rows.length > 0) {
              // Use all municipalities in the prefecture for maximum results
              municipalityGemiId = municipalitiesResult.rows
                .map(row => parseInt(row.gemi_id, 10))
                .filter(id => !isNaN(id));
              
              console.log(`[runDiscoveryJob] Prefecture selected: Found ${municipalityGemiId.length} municipalities, using all for maximum results`);
              console.log(`[runDiscoveryJob] Municipality GEMI IDs: [${municipalityGemiId.slice(0, 10).join(', ')}${municipalityGemiId.length > 10 ? '...' : ''}]`);
            } else {
              // Fallback: Use prefecture-level query if no municipalities found
              if (finalPrefectureGemiId) {
                prefectureGemiId = finalPrefectureGemiId;
                console.log(`[runDiscoveryJob] No municipalities found for prefecture, using prefecture-level query: ${prefectureGemiId}`);
              } else {
                throw new Error(`Prefecture not found: ${finalPrefectureId || finalPrefectureGemiId}`);
              }
            }
          } else {
            throw new Error(`Prefecture not found: ${finalPrefectureId || finalPrefectureGemiId}`);
          }
        } else {
          throw new Error(`Prefecture not found: ${finalPrefectureId || finalPrefectureGemiId}`);
        }
      } else {
        throw new Error('municipality_id, municipality_gemi_id, prefecture_id, or prefecture_gemi_id is required for GEMI discovery');
      }
      
      if (municipalityGemiId !== undefined || prefectureGemiId !== undefined) {
        // Collect all activity IDs (gemi_ids) from all industries in the group
        let activityIds: number[] | undefined;
        
        if (input.industry_group_id && industriesInGroup.length > 0) {
          // Get all gemi_ids from all industries in the group
          const industryIds = industriesInGroup.map((i: { id: string; name: string; discovery_keywords: string[] | null; search_weight: number | null }) => i.id);
          const allIndustriesResult = await pool.query<{ gemi_id: number }>(
            'SELECT gemi_id FROM industries WHERE id = ANY($1) AND gemi_id IS NOT NULL',
            [industryIds]
          );
          activityIds = allIndustriesResult.rows
            .map(row => row.gemi_id)
            .filter(id => id != null && !isNaN(id));
          console.log(`[runDiscoveryJob] Found ${activityIds.length} activity IDs from industry group: [${activityIds.join(', ')}]`);
        } else {
          // For single industry, use industry_gemi_id directly if available (preferred), otherwise get from industry_id
          const singleActivityId = finalIndustryGemiId;
          if (!singleActivityId && finalIndustryId) {
            const industryResult = await pool.query<{ gemi_id: number }>(
              'SELECT gemi_id FROM industries WHERE id = $1',
              [finalIndustryId]
            );
            if (industryResult.rows[0]?.gemi_id) {
              activityIds = [industryResult.rows[0].gemi_id];
            }
          } else if (singleActivityId) {
            activityIds = [singleActivityId];
          }
        }

        const locationDesc = municipalityGemiId 
          ? (Array.isArray(municipalityGemiId)
              ? `${municipalityGemiId.length} municipalities`
              : `municipality_gemi_id=${municipalityGemiId}`)
          : `prefecture_gemi_id=${prefectureGemiId}`;
        const activityDesc = activityIds 
          ? (activityIds.length === 1 ? `activity_id=${activityIds[0]}` : `${activityIds.length} activities: [${activityIds.join(', ')}]`)
          : 'no activity filter';
        console.log(`[runDiscoveryJob] Fetching from GEMI API: ${locationDesc}, ${activityDesc}`);

        // Import GEMI service functions
        const { fetchGemiCompaniesForMunicipality, importGemiCompaniesToDatabase } = await import('./gemiService.js');
        
        try {
          // Fetch companies from GEMI API (supports municipality, multiple municipalities, or prefecture)
          // ENHANCEMENT: Make separate API calls for each municipality + activity combination
          // This ensures maximum reliability and completeness, especially for large prefectures like Attica
          let allCompanies: any[] = [];
          let totalSearchesExecuted = 0;
          
          // Determine if we should make separate calls per municipality
          // If we have many municipalities (e.g., Attica has ~60), make separate calls for better reliability
          const shouldSplitByMunicipality = municipalityGemiId && municipalityGemiId.length > 10;
          
          if (shouldSplitByMunicipality && municipalityGemiId) {
            console.log(`[runDiscoveryJob] Large number of municipalities (${municipalityGemiId.length}), making separate calls per municipality for maximum reliability...`);
            
            // Make separate calls for each municipality + activity combination
            for (let m = 0; m < municipalityGemiId.length; m++) {
              const singleMunicipalityId = municipalityGemiId[m];
              console.log(`[runDiscoveryJob] Processing municipality ${m + 1}/${municipalityGemiId.length}: municipality_gemi_id=${singleMunicipalityId}`);
              
              // For each municipality, query all activities
              if (activityIds && activityIds.length > 1) {
                // Multiple activities: make separate call for each activity
                for (let a = 0; a < activityIds.length; a++) {
                  const activityId = activityIds[a];
                  console.log(`[runDiscoveryJob] Municipality ${singleMunicipalityId}, Activity ${a + 1}/${activityIds.length}: activity_id=${activityId}`);
                  
                  let currentOffset: number | undefined = undefined;
                  let hasMore = true;
                  let municipalityActivityCompanies: any[] = [];

                  while (hasMore) {
                    const result = await fetchGemiCompaniesForMunicipality(
                      singleMunicipalityId, // Single municipality
                      activityId, // Single activity
                      undefined, // No prefecture when using municipality
                      currentOffset
                    );

                    municipalityActivityCompanies = municipalityActivityCompanies.concat(result.companies);
                    currentOffset = result.nextOffset;
                    hasMore = result.hasMore;
                    totalSearchesExecuted++;

                    console.log(`[runDiscoveryJob] Municipality ${singleMunicipalityId}, Activity ${activityId}: Fetched ${result.companies.length} companies (total: ${municipalityActivityCompanies.length}), nextOffset: ${currentOffset}, hasMore: ${hasMore}`);

                    // If we hit the safety limit but there's more data, continue fetching
                    if (!hasMore && currentOffset >= 10000) {
                      console.log(`[runDiscoveryJob] Municipality ${singleMunicipalityId}, Activity ${activityId}: Hit safety limit at offset ${currentOffset}, continuing...`);
                      hasMore = true;
                    } else if (!hasMore) {
                      break;
                    }
                  }
                  
                  console.log(`[runDiscoveryJob] Municipality ${singleMunicipalityId}, Activity ${activityId}: Total ${municipalityActivityCompanies.length} companies found`);
                  allCompanies = allCompanies.concat(municipalityActivityCompanies);
                }
              } else {
                // Single activity (or no activity filter) - single call per municipality
                const activityId = activityIds && activityIds.length > 0 ? activityIds[0] : undefined;
                let currentOffset: number | undefined = undefined;
                let hasMore = true;
                let municipalityCompanies: any[] = [];

                while (hasMore) {
                  const result = await fetchGemiCompaniesForMunicipality(
                    singleMunicipalityId,
                    activityId,
                    undefined,
                    currentOffset
                  );

                  municipalityCompanies = municipalityCompanies.concat(result.companies);
                  currentOffset = result.nextOffset;
                  hasMore = result.hasMore;
                  totalSearchesExecuted++;

                  console.log(`[runDiscoveryJob] Municipality ${singleMunicipalityId}: Fetched ${result.companies.length} companies (total: ${municipalityCompanies.length}), nextOffset: ${currentOffset}, hasMore: ${hasMore}`);

                  if (!hasMore && currentOffset >= 10000) {
                    console.log(`[runDiscoveryJob] Municipality ${singleMunicipalityId}: Hit safety limit at offset ${currentOffset}, continuing...`);
                    hasMore = true;
                  } else if (!hasMore) {
                    break;
                  }
                }
                
                console.log(`[runDiscoveryJob] Municipality ${singleMunicipalityId}: Total ${municipalityCompanies.length} companies found`);
                allCompanies = allCompanies.concat(municipalityCompanies);
              }
            }
          } else if (activityIds && activityIds.length > 1) {
            // Multiple activities but few municipalities - make separate calls per activity
            console.log(`[runDiscoveryJob] Making separate API calls for each of ${activityIds.length} activity IDs to ensure complete results...`);
            
            for (let i = 0; i < activityIds.length; i++) {
              const activityId = activityIds[i];
              console.log(`[runDiscoveryJob] Fetching activity ${i + 1}/${activityIds.length}: activity_id=${activityId}`);
              
              let currentOffset: number | undefined = undefined;
              let hasMore = true;
              let activityCompanies: any[] = [];

              while (hasMore) {
                const result = await fetchGemiCompaniesForMunicipality(
                  municipalityGemiId,
                  activityId, // Single activity ID per call
                  prefectureGemiId,
                  currentOffset
                );

                activityCompanies = activityCompanies.concat(result.companies);
                currentOffset = result.nextOffset;
                hasMore = result.hasMore;
                totalSearchesExecuted++;

                console.log(`[runDiscoveryJob] Activity ${activityId}: Fetched ${result.companies.length} companies (total for this activity: ${activityCompanies.length}), nextOffset: ${currentOffset}, hasMore: ${hasMore}`);

                // If we hit the safety limit but there's more data, continue fetching
                if (!hasMore && currentOffset >= 10000) {
                  console.log(`[runDiscoveryJob] Activity ${activityId}: Hit safety limit at offset ${currentOffset}, continuing to fetch more...`);
                  hasMore = true; // Continue fetching from this offset
                } else if (!hasMore) {
                  // No more data available for this activity
                  break;
                }
              }
              
              console.log(`[runDiscoveryJob] Activity ${activityId}: Total ${activityCompanies.length} companies found`);
              allCompanies = allCompanies.concat(activityCompanies);
            }
          } else {
            // Single activity ID (or no activity filter) - use original logic
            let currentOffset: number | undefined = undefined;
            let hasMore = true;

            while (hasMore) {
              const result = await fetchGemiCompaniesForMunicipality(
                municipalityGemiId,
                activityIds && activityIds.length > 0 ? activityIds[0] : undefined,
                prefectureGemiId,
                currentOffset
              );

              allCompanies = allCompanies.concat(result.companies);
              currentOffset = result.nextOffset;
              hasMore = result.hasMore;
              totalSearchesExecuted++;

              console.log(`[runDiscoveryJob] Fetched ${result.companies.length} companies (total: ${allCompanies.length}), nextOffset: ${currentOffset}, hasMore: ${hasMore}`);

              // If we hit the safety limit but there's more data, continue fetching
              if (!hasMore && currentOffset >= 10000) {
                console.log(`[runDiscoveryJob] Hit safety limit at offset ${currentOffset}, continuing to fetch more...`);
                hasMore = true; // Continue fetching from this offset
              } else if (!hasMore) {
                // No more data available
                break;
              }
            }
          }

          console.log(`[runDiscoveryJob] Total fetched ${allCompanies.length} companies from GEMI API in ${totalSearchesExecuted} batch(es)`);
          
          // Remove duplicates based on ar_gemi (same business might appear in multiple activity results)
          const uniqueCompanies = new Map<string, any>();
          for (const company of allCompanies) {
            const arGemi = company.ar_gemi || company.arGemi;
            if (arGemi && !uniqueCompanies.has(arGemi)) {
              uniqueCompanies.set(arGemi, company);
            }
          }
          const deduplicatedCompanies = Array.from(uniqueCompanies.values());
          console.log(`[runDiscoveryJob] Removed ${allCompanies.length - deduplicatedCompanies.length} duplicate companies (${deduplicatedCompanies.length} unique companies)`);

          // Import companies to database (pass discoveryRunId if available)
          const importResult = await importGemiCompaniesToDatabase(
            deduplicatedCompanies,
            datasetId,
            input.userId || 'system',
            input.discoveryRunId || undefined // Pass discoveryRunId to link businesses
          );

          discoveryResult = {
            businessesFound: deduplicatedCompanies.length,
            businessesCreated: importResult.inserted,
            businessesUpdated: importResult.updated,
            searchesExecuted: totalSearchesExecuted,
            errors: [],
          };

          console.log(`[runDiscoveryJob] GEMI import completed: ${importResult.inserted} inserted, ${importResult.updated} updated`);
          // Note: Email enrichment now happens only on export request, not during discovery
        } catch (error: any) {
          // 404 errors are handled in gemiService and return empty array, so they shouldn't reach here
          // But if they do, treat them as "no results" rather than an error
          if (error.response && error.response.status === 404) {
            const locationDesc = municipalityGemiId 
              ? (Array.isArray(municipalityGemiId)
                  ? `${municipalityGemiId.length} municipalities`
                  : `municipality ${municipalityGemiId}`)
              : `prefecture ${prefectureGemiId}`;
            const activityDesc = activityIds 
              ? (activityIds.length === 1 ? `activity ${activityIds[0]}` : `${activityIds.length} activities: [${activityIds.join(', ')}]`)
              : 'all activities';
            console.log(`[runDiscoveryJob] No businesses found for ${locationDesc} and ${activityDesc} (404)`);
            discoveryResult = {
              businessesFound: 0,
              businessesCreated: 0,
              businessesUpdated: 0,
              searchesExecuted: 1, // Still count as a search attempt
              errors: [], // No error - just no results
            };
          } else {
            console.error(`[runDiscoveryJob] GEMI API error:`, error.message);
            discoveryResult = {
              businessesFound: 0,
              businessesCreated: 0,
              businessesUpdated: 0,
              searchesExecuted: 0,
              errors: [error.message || 'Failed to fetch from GEMI API'],
            };
          }
        }
      } else {
        // municipalityGemiId was not found/assigned, discoveryResult should already be set above
        // But if it wasn't, set a default
        if (!discoveryResult) {
          discoveryResult = {
            businessesFound: 0,
            businessesCreated: 0,
            businessesUpdated: 0,
            searchesExecuted: 0,
            errors: ['Municipality GEMI ID not found'],
          };
        }
      }
    } else {
      // Businesses already exist in local DB, but we need to link them to this dataset
      console.log(`[runDiscoveryJob] Found ${existingCount} existing businesses, linking them to dataset ${datasetId}...`);
      
      // Update existing businesses to link them to this dataset and discovery run
      let updatedCount = 0;
      try {
        // Build WHERE clause based on discovery criteria
        let whereClause = '';
        const updateParams: any[] = [datasetId, discoveryRun.id];
        let paramIndex = 3;
        
        if (finalMunicipalityId) {
          whereClause += ` AND municipality_id = $${paramIndex++}`;
          updateParams.push(finalMunicipalityId);
        } else if (finalMunicipalityGemiId) {
          // Get municipality IDs from GEMI IDs
          const municipalityGemiIds = Array.isArray(finalMunicipalityGemiId) 
            ? finalMunicipalityGemiId 
            : [finalMunicipalityGemiId];
          whereClause += ` AND municipality_id IN (
            SELECT id FROM municipalities WHERE gemi_id = ANY($${paramIndex++}::text[])
          )`;
          updateParams.push(municipalityGemiIds.map(String));
        } else if (finalPrefectureId || finalPrefectureGemiId) {
          const prefectureIdToUse = finalPrefectureId || 
            (finalPrefectureGemiId ? await (async () => {
              const prefResult = await pool.query<{ id: string }>(
                'SELECT id FROM prefectures WHERE gemi_id = $1',
                [String(finalPrefectureGemiId)]
              );
              return prefResult.rows[0]?.id;
            })() : null);
          
          if (prefectureIdToUse) {
            whereClause += ` AND prefecture_id = $${paramIndex++}`;
            updateParams.push(prefectureIdToUse);
          }
        }
        
        // Update businesses to link them to this dataset
        const updateResult = await pool.query<{ count: string }>(
          `UPDATE businesses 
           SET dataset_id = $1, 
               discovery_run_id = COALESCE($2, discovery_run_id),
               updated_at = NOW()
           WHERE dataset_id IS NULL OR dataset_id != $1
             ${whereClause}
           RETURNING id`,
          updateParams
        );
        
        updatedCount = updateResult.rowCount || 0;
        console.log(`[runDiscoveryJob] Linked ${updatedCount} existing businesses to dataset ${datasetId}`);
      } catch (updateError: any) {
        console.error(`[runDiscoveryJob] Error linking existing businesses to dataset:`, updateError.message);
        // Continue even if update fails - businesses still exist
      }
      
      discoveryResult = {
        businessesFound: existingCount,
        businessesCreated: 0,
        businessesUpdated: updatedCount,
        searchesExecuted: 0,
        errors: [],
      };
    }
    
    console.log(`[runDiscoveryJob] GEMI discovery completed:`, {
      businessesFound: discoveryResult.businessesFound,
      businessesCreated: discoveryResult.businessesCreated,
      businessesUpdated: discoveryResult.businessesUpdated,
      searchesExecuted: discoveryResult.searchesExecuted,
      errors: discoveryResult.errors.length,
    });

    // Mark dataset as refreshed after successful discovery
    if (!isReused || discoveryResult.businessesCreated > 0) {
      await markDatasetRefreshed(datasetId);
      console.log(`[runDiscoveryJob] Marked dataset as refreshed: ${datasetId}`);
    }

    // Get count of businesses with websites created in this discovery run
    const businessesWithWebsitesResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM businesses
       WHERE discovery_run_id = $1
         AND website_url IS NOT NULL
         AND website_url != ''`,
      [discoveryRun.id]
    );
    const totalWebsitesProcessed = parseInt(businessesWithWebsitesResult.rows[0]?.count || '0', 10);

    // Create crawl jobs for all new businesses with websites
    const businessesWithWebsites = await pool.query<{ id: string; website_url: string }>(
      `SELECT id, website_url
       FROM businesses
       WHERE discovery_run_id = $1
         AND website_url IS NOT NULL
         AND website_url != ''`,
      [discoveryRun.id]
    );

    let crawlJobsCreated = 0;
    for (const business of businessesWithWebsites.rows) {
      try {
        // Create crawl job using business_id and website_url (new schema)
        // Check if crawl job already exists for this business and website
        const existingJob = await pool.query(
          `SELECT id FROM crawl_jobs WHERE business_id = $1 AND website_url = $2 LIMIT 1`,
          [business.id, business.website_url]
        );
        
        if (existingJob.rows.length === 0) {
          const jobId = randomUUID();
          await pool.query(
            `INSERT INTO crawl_jobs (id, business_id, website_url, status, pages_limit, pages_crawled, created_at)
             VALUES ($1, $2, $3, 'queued', 25, 0, NOW())`,
            [jobId, business.id, business.website_url]
          );
          crawlJobsCreated++;
        }
        crawlJobsCreated++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to create crawl job for business ${business.id}: ${errorMsg}`);
      }
    }

    const endTime = new Date();

    const result: JobResult = {
      jobId,
      jobType: 'discovery',
      startTime,
      endTime,
      totalWebsitesProcessed,
      contactsAdded: 0, // Discovery doesn't extract contacts directly
      contactsRemoved: 0, // Discovery never removes contacts
      contactsVerified: 0, // Discovery doesn't verify existing contacts
      errors: [...discoveryResult.errors, ...errors],
      gated: isGated, // True if limited by plan
      upgrade_hint: upgradeHint, // Upgrade suggestion if gated
    };

    // Log discovery action
    logDiscoveryAction({
      userId: input.userId || 'unknown',
      datasetId,
      resultSummary: `Discovery completed: ${discoveryResult.businessesFound} businesses found, ${discoveryResult.businessesCreated} created, ${crawlJobsCreated} crawl jobs created`,
      gated: isGated,
      error: errors.length > 0 ? errors.join('; ') : null,
      metadata: {
        job_id: jobId,
        industry: input.industry,
        city: input.city,
        businesses_found: discoveryResult.businessesFound,
        businesses_created: discoveryResult.businessesCreated,
        businesses_updated: discoveryResult.businessesUpdated,
        searches_executed: discoveryResult.searchesExecuted,
        contacts_created: 0, // Contacts are created in extraction phase, not discovery
        extraction_jobs_created: 0, // Extraction jobs are created separately
        // Note: websites_created removed - websites are created in extraction phase
        crawl_jobs_created: crawlJobsCreated,
        duration_seconds: (endTime.getTime() - startTime.getTime()) / 1000,
        is_reused: isReused,
        upgrade_hint: upgradeHint,
      },
    });

    console.log(`\n✅ DISCOVERY job completed: ${jobId}`);
    console.log(`   Duration: ${(endTime.getTime() - startTime.getTime()) / 1000}s`);
    console.log(`   Businesses found: ${discoveryResult.businessesFound}`);
    console.log(`   Businesses created: ${discoveryResult.businessesCreated}`);
    // Note: Websites are created in extraction phase, not discovery
    console.log(`   Crawl jobs created: ${crawlJobsCreated}`);

    // Mark discovery_run as completed
    // Note: Even if no businesses were found, discovery is still considered complete
    try {
      if (typeof discoveryRun !== 'undefined') {
        await updateDiscoveryRun(discoveryRun.id, {
          status: 'completed',
          completed_at: new Date(),
        });
        console.log(`[runDiscoveryJob] Marked discovery_run as completed: ${discoveryRun.id} (found ${discoveryResult.businessesFound} businesses)`);
      } else {
        console.warn('[runDiscoveryJob] discoveryRun is undefined, cannot mark as completed');
      }
    } catch (updateError) {
      console.error('[runDiscoveryJob] Failed to update discovery_run status to completed:', updateError);
    }

    return result;
  } catch (error) {
    const endTime = new Date();
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : 'No stack trace';
    errors.push(`Discovery job failed: ${errorMsg}`);
    
    console.error('[runDiscoveryJob] ===== DISCOVERY JOB ERROR =====');
    console.error('[runDiscoveryJob] Error message:', errorMsg);
    console.error('[runDiscoveryJob] Error stack:', errorStack);
    console.error('[runDiscoveryJob] Full error object:', error);
    
    // Mark discovery_run as failed if it was created
    // Ensure it always ends in completed or failed, never stuck in running
    try {
      if (typeof discoveryRun !== 'undefined') {
        await updateDiscoveryRun(discoveryRun.id, {
          status: 'failed',
          completed_at: new Date(),
          started_at: discoveryRun.started_at || new Date() // Set started_at if not already set
        });
        console.log(`[runDiscoveryJob] Marked discovery_run as failed due to error: ${discoveryRun.id}`);
      }
    } catch (updateError) {
      console.error('[runDiscoveryJob] Failed to update discovery_run status:', updateError);
    }

    // Log error action
    logDiscoveryAction({
      userId: input.userId || 'unknown',
      datasetId: undefined,
      resultSummary: `Discovery failed: ${errorMsg}`,
      gated: false,
      error: errorMsg,
      metadata: {
        job_id: jobId,
        industry: input.industry,
        city: input.city,
        error_type: error instanceof Error ? error.name : 'Error',
      },
    });

    console.error(`\n❌ DISCOVERY job failed: ${jobId}`);
    console.error(`   Error: ${errorMsg}`);

    return {
      jobId,
      jobType: 'discovery',
      startTime,
      endTime,
      totalWebsitesProcessed: 0,
      contactsAdded: 0,
      contactsRemoved: 0,
      contactsVerified: 0,
      errors
    };
  }
}
