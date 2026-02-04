import type { DiscoveryJobInput, JobResult } from '../types/jobs.js';
import { discoverBusinessesV2 } from '../workers/discoveryWorkerV2.js';
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

/**
 * Run a discovery job
 * This is for ad-hoc, paid discovery requests
 * Uses geo-grid discovery and creates new businesses
 */
export async function runDiscoveryJob(input: DiscoveryJobInput): Promise<JobResult> {
  const startTime = new Date();
  const jobId = `discovery-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const errors: string[] = [];

  console.log(`\n🔍 Starting DISCOVERY job: ${jobId}`);
  console.log(`   Industry: ${input.industry}`);
  console.log(`   City: ${input.city}`);
  console.log(`   Discovery method: V2 Grid-Based (always uses grid + keyword expansion)`);

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

    // Run discovery using grid-based V2 worker (always uses grid + keyword expansion)
    // If gated, discovery will still run but we'll mark it in the result
    const discoveryResult = await discoverBusinessesV2({
      industry: input.industry, // Legacy support
      industry_id: input.industry_id, // Preferred
      city: input.city, // Legacy support
      city_id: input.city_id, // Preferred
      latitude: input.latitude,
      longitude: input.longitude,
      cityRadiusKm: input.cityRadiusKm,
      datasetId: datasetId
    }, discoveryRun.id);

    // Mark dataset as refreshed after successful discovery
    if (!isReused || discoveryResult.businessesCreated > 0) {
      await markDatasetRefreshed(datasetId);
      console.log(`[runDiscoveryJob] Marked dataset as refreshed: ${datasetId}`);
    }

    // CRITICAL: Discovery MUST ALWAYS complete
    // Mark discovery_run as completed after all businesses are processed
    // Extraction jobs will be processed separately by extraction worker
    // NOTE: discoveryWorker also marks discovery_run as completed after enqueuing extraction jobs
    // This is idempotent - both updates will result in 'completed' status
    const { getExtractionJobsByDiscoveryRunId } = await import('../db/extractionJobs.js');
    const extractionJobs = await getExtractionJobsByDiscoveryRunId(discoveryRun.id);
    
    console.log(`[runDiscoveryJob] Found ${extractionJobs.length} extraction jobs for discovery_run: ${discoveryRun.id}`);
    
    // ALWAYS mark discovery_run as completed after processing
    // Even if 0 businesses were found or 0 extraction jobs were created
    await updateDiscoveryRun(discoveryRun.id, {
      status: 'completed',
      completed_at: new Date()
    });
    console.log(`[runDiscoveryJob] Marked discovery_run as completed: ${discoveryRun.id}`);
    
    if (extractionJobs.length > 0) {
      console.log(`[runDiscoveryJob] ${extractionJobs.length} extraction jobs will be processed by extraction worker`);
    } else {
      console.log(`[runDiscoveryJob] No extraction jobs created (no new businesses found)`);
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
        grid_points_generated: discoveryResult.gridPointsGenerated,
        searches_executed: discoveryResult.searchesExecuted,
        coverage_score: discoveryResult.coverageScore,
        stopped_early: discoveryResult.stoppedEarly,
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
    errors.push(`Discovery job failed: ${errorMsg}`);
    
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
