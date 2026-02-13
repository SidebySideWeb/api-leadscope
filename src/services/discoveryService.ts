import type { DiscoveryJobInput, JobResult } from '../types/jobs.js';
import { runVriskoDiscovery } from '../discovery/vriskoWorker.js';
import { createCrawlJob } from '../db/crawlJobs.js';
import { pool } from '../config/database.js';
import type { Website } from '../types/index.js';
import { resolveDataset, markDatasetRefreshed } from './datasetResolver.js';
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
    console.log(`   Discovery method: Vrisko.gr (ONLY source - no Google Maps)`);

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

      // Resolve dataset - prefer IDs, fallback to names (must exist, won't create)
      const resolverResult = await resolveDataset({
        userId: input.userId,
        cityId: input.city_id, // Use city ID if available
        cityName: input.city_id ? undefined : input.city, // Only use city name if city_id not provided
        industryId: input.industry_id, // Use industry ID if available
        industryName: input.industry_id ? undefined : input.industry, // Only use industry name if industry_id not provided
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
      discoveryRun = await createDiscoveryRun(datasetId, input.userId);
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

    // Count cities in this dataset
    const citiesResult = await pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT city_id) as count
       FROM businesses
       WHERE dataset_id = $1`,
      [datasetId]
    );
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
    if (!input.municipality_gemi_id && !input.municipality_id && !input.city_id && !input.city) {
      throw new Error('municipality_gemi_id, municipality_id, city_id, or city is required for discovery');
    }

    // Resolve industry_id from industry_gemi_id if needed
    let finalIndustryId = input.industry_id;
    let finalIndustryGemiId = input.industry_gemi_id;
    
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

    // Resolve municipality_id from municipality_gemi_id if needed
    let finalMunicipalityId = input.municipality_id;
    let finalMunicipalityGemiId = input.municipality_gemi_id;
    let finalCityId = input.city_id;

    if (input.municipality_gemi_id && !finalMunicipalityId) {
      const municipalityResult = await pool.query<{ id: string; gemi_id: string }>(
        'SELECT id, gemi_id FROM municipalities WHERE gemi_id = $1',
        [input.municipality_gemi_id.toString()]
      );
      if (municipalityResult.rows.length === 0) {
        throw new Error(`Municipality with gemi_id ${input.municipality_gemi_id} not found`);
      }
      finalMunicipalityId = municipalityResult.rows[0].id;
      finalMunicipalityGemiId = parseInt(municipalityResult.rows[0].gemi_id, 10);
      console.log(`[runDiscoveryJob] Resolved municipality_gemi_id ${input.municipality_gemi_id} to municipality_id ${finalMunicipalityId}`);
    } else if (finalMunicipalityId && !finalMunicipalityGemiId) {
      // Get gemi_id from municipality_id
      const municipalityResult = await pool.query<{ gemi_id: string }>(
        'SELECT gemi_id FROM municipalities WHERE id = $1',
        [finalMunicipalityId]
      );
      if (municipalityResult.rows.length > 0) {
        finalMunicipalityGemiId = parseInt(municipalityResult.rows[0].gemi_id, 10);
      }
    }

    if (!finalCityId && input.city) {
      const { getCityByNormalizedName } = await import('../db/cities.js');
      const { normalizeCityName } = await import('../utils/cityNormalizer.js');
      const city = await getCityByNormalizedName(normalizeCityName(input.city));
      if (!city) {
        throw new Error(`City "${input.city}" not found`);
      }
      finalCityId = city.id;
    }

    if (!finalIndustryId) {
      throw new Error('Could not resolve industry_id');
    }
    
    // municipality_gemi_id is preferred for GEMI discovery
    if (!finalMunicipalityGemiId && !finalMunicipalityId && !finalCityId) {
      throw new Error('Could not resolve municipality_gemi_id, municipality_id, or city_id');
    }

    // STEP 1: Check local database first for existing businesses
    // Use municipality_id if available, otherwise use city_id
    console.log(`[runDiscoveryJob] Checking local database for existing businesses...`);
    let existingBusinessesResult;
    if (finalMunicipalityId) {
      existingBusinessesResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM businesses
         WHERE dataset_id = $1
           AND municipality_id = $2
           AND industry_id = $3`,
        [datasetId, finalMunicipalityId, finalIndustryId]
      );
    } else if (finalCityId) {
      existingBusinessesResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM businesses
         WHERE dataset_id = $1
           AND city_id = $2
           AND industry_id = $3`,
        [datasetId, finalCityId, finalIndustryId]
      );
    } else {
      throw new Error('Either city_id or municipality_id is required');
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
      
      let municipalityGemiId: number | undefined;
      
      // Use municipality_gemi_id directly if available (preferred)
      if (finalMunicipalityGemiId) {
        municipalityGemiId = finalMunicipalityGemiId;
        console.log(`[runDiscoveryJob] Using municipality_gemi_id directly: ${municipalityGemiId}`);
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
        
        municipalityGemiId = parseInt(municipalityResult.rows[0].gemi_id, 10);
      } else if (finalCityId) {
        // Legacy: Get city info to find municipality
        const cityResult = await pool.query<{ name: string; normalized_name: string }>(
          'SELECT name, normalized_name FROM cities WHERE id = $1',
          [finalCityId]
        );
        const city = cityResult.rows[0];
        
        if (!city) {
          throw new Error(`City with id ${finalCityId} not found`);
        }

        // Find municipality by matching city name (try both English and Greek)
        const municipalityResult = await pool.query<{ id: string; gemi_id: string }>(
          `SELECT id, gemi_id FROM municipalities 
           WHERE descr ILIKE $1 OR descr_en ILIKE $1 OR descr ILIKE $2 OR descr_en ILIKE $2
           LIMIT 1`,
          [city.name, city.normalized_name]
        );
        
        if (municipalityResult.rows.length === 0) {
          console.warn(`[runDiscoveryJob] No municipality found for city ${city.name}, skipping GEMI fetch`);
          discoveryResult = {
            businessesFound: 0,
            businessesCreated: 0,
            businessesUpdated: 0,
            searchesExecuted: 0,
            errors: [`No municipality found for city: ${city.name}`],
          };
        } else {
          municipalityGemiId = parseInt(municipalityResult.rows[0].gemi_id, 10);
        }
      } else {
        throw new Error('Either city_id or municipality_id is required for GEMI discovery');
      }
      
      if (municipalityGemiId !== undefined) {
        // Use industry_gemi_id directly if available (preferred), otherwise get from industry_id
        let industryGemiId = finalIndustryGemiId;
        if (!industryGemiId) {
          const industryResult = await pool.query<{ gemi_id: number }>(
            'SELECT gemi_id FROM industries WHERE id = $1',
            [finalIndustryId]
          );
          industryGemiId = industryResult.rows[0]?.gemi_id || undefined;
        }

        console.log(`[runDiscoveryJob] Fetching from GEMI API: municipality_gemi_id=${municipalityGemiId}, activity_id=${industryGemiId}`);

        // Import GEMI service functions
        const { fetchGemiCompaniesForMunicipality, importGemiCompaniesToDatabase } = await import('./gemiService.js');
        
        try {
          // Fetch companies from GEMI API
          const companies = await fetchGemiCompaniesForMunicipality(
            municipalityGemiId,
            industryGemiId
          );

          console.log(`[runDiscoveryJob] Fetched ${companies.length} companies from GEMI API`);

          // Import companies to database (pass city_id if available, otherwise undefined)
          const importResult = await importGemiCompaniesToDatabase(
            companies,
            datasetId,
            input.userId || 'system',
            finalCityId || undefined // Pass cityId if available
          );

          discoveryResult = {
            businessesFound: companies.length,
            businessesCreated: importResult.inserted,
            businessesUpdated: importResult.updated,
            searchesExecuted: 1, // One GEMI API call
            errors: [],
          };

          console.log(`[runDiscoveryJob] GEMI import completed: ${importResult.inserted} inserted, ${importResult.updated} updated`);
        } catch (error: any) {
          console.error(`[runDiscoveryJob] GEMI API error:`, error.message);
          discoveryResult = {
            businessesFound: 0,
            businessesCreated: 0,
            businessesUpdated: 0,
            searchesExecuted: 0,
            errors: [error.message || 'Failed to fetch from GEMI API'],
          };
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
      // Businesses already exist in local DB, no need to fetch from GEMI
      console.log(`[runDiscoveryJob] Using existing businesses from local database`);
      discoveryResult = {
        businessesFound: existingCount,
        businessesCreated: 0,
        businessesUpdated: 0,
        searchesExecuted: 0,
        errors: [],
      };
    }
    
    console.log(`[runDiscoveryJob] Vrisko discovery completed:`, {
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

    // Get count of websites created
    const websitesResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM websites
       WHERE created_at >= $1`,
      [startTime]
    );
    const totalWebsitesProcessed = parseInt(websitesResult.rows[0]?.count || '0', 10);

    // Create crawl jobs for all new websites
    const websitesResult2 = await pool.query<Website>(
      `SELECT * FROM websites WHERE created_at >= $1`,
      [startTime]
    );

    let crawlJobsCreated = 0;
    for (const website of websitesResult2.rows) {
      try {
        await createCrawlJob(website.id);
        crawlJobsCreated++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to create crawl job for website ${website.id}: ${errorMsg}`);
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
          error_message: errorMsg,
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
