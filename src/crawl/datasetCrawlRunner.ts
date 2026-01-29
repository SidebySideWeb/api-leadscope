/**
 * Dataset-wide Crawl Enqueue + Worker Loop
 *
 * Goals:
 * - Enqueue crawl_jobs for all businesses in a dataset that have a website URL.
 * - Run crawler sequentially or with small concurrency (no Redis).
 * - Store results to crawl_results v1 via crawlWorkerV1.
 * - Respect plan gates (demo depth <= max_crawl_pages, safety caps inside worker).
 * - Keep behavior idempotent: avoid duplicate recent jobs per business.
 * - Log actions in a readable, structured way.
 */

import { randomUUID } from 'crypto';
import { pool } from '../config/database.js';
import { getDatasetById } from '../db/datasets.js';
import { getUserPermissions } from '../db/permissions.js';
import { logCrawlAction } from '../utils/actionLogger.js';
import {
  getQueuedCrawlJobs,
  markCrawlJobRunning,
  markCrawlJobSuccess,
  markCrawlJobFailed,
  type CrawlJobRecord,
} from '../db/crawlJobs.js';
import { crawlWorkerV1 } from '../workers/crawlWorkerV1.js';

interface EnqueueResult {
  totalBusinesses: number;
  jobsCreated: number;
  jobsSkipped: number;
}

export interface DatasetCrawlOptions {
  datasetId: string;
  userId: string;
  maxDepth: number;
  concurrency: number;
}

/**
 * Enqueue crawl_jobs for all businesses in a dataset that have a website URL.
 *
 * Idempotency:
 * - Skips businesses that already have a recent queued/running job.
 */
export async function enqueueCrawlJobsForDataset(
  datasetId: string,
  pagesLimit: number,
): Promise<EnqueueResult> {
  // 1. Select businesses with websites for this dataset
  // We assume websites table stores URLs per business.
  const businessesResult = await pool.query<{
    business_id: number;
    website_url: string;
  }>(
    `
    SELECT DISTINCT ON (b.id)
      b.id AS business_id,
      w.url AS website_url
    FROM businesses b
    JOIN websites w ON w.business_id = b.id
    WHERE b.dataset_id = $1
      AND w.url IS NOT NULL
    ORDER BY b.id, w.created_at DESC NULLS LAST
    `,
    [datasetId],
  );

  const businesses = businessesResult.rows;
  let jobsCreated = 0;
  let jobsSkipped = 0;

  for (const row of businesses) {
    const businessId = row.business_id;
    const websiteUrl = row.website_url;
    const businessIdStr = String(businessId);

    // 2. Check for recent queued/running job for this business (idempotency)
    const existing = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM crawl_jobs
      WHERE business_id = $1
        AND status IN ('pending', 'running', 'queued')
        AND created_at >= NOW() - INTERVAL '1 day'
      LIMIT 1
      `,
      [businessIdStr],
    );

    if (existing.rows.length > 0) {
      jobsSkipped += 1;
      continue;
    }

    // 3. Insert new crawl_job with status queued
    const jobId = randomUUID();
    await pool.query(
      `
      INSERT INTO crawl_jobs (
        id,
        business_id,
        website_url,
        status,
        pages_limit,
        pages_crawled,
        attempts,
        created_at
      ) VALUES ($1, $2, $3, 'queued', $4, 0, 0, NOW())
      `,
      [jobId, businessIdStr, websiteUrl, pagesLimit],
    );

    jobsCreated += 1;
  }

  return {
    totalBusinesses: businesses.length,
    jobsCreated,
    jobsSkipped,
  };
}

/**
 * Process queued crawl_jobs for a dataset with small concurrency.
 *
 * NOTE:
 * - Uses crawlWorkerV1, which already enforces plan limits and safety caps.
 * - This loop only manages job status transitions + logging.
 */
export async function processDatasetCrawlJobs(
  options: DatasetCrawlOptions,
): Promise<void> {
  const { datasetId, userId, maxDepth, concurrency } = options;

  // 1. Verify dataset exists and belongs to user (defensive)
  const dataset = await getDatasetById(datasetId);
  if (!dataset) {
    console.error(`[datasetCrawl] Dataset not found: ${datasetId}`);
    return;
  }
  if (dataset.user_id !== userId) {
    console.error(
      `[datasetCrawl] Dataset ${datasetId} does not belong to user ${userId}`,
    );
    return;
  }

  // 2. Get user permissions (for logging + depth hints)
  const permissions = await getUserPermissions(userId);
  const planId = permissions.plan;
  const isInternalUser = permissions.is_internal_user;

  // Effective max depth (plan gate)
  const effectiveMaxDepth = isInternalUser
    ? Math.min(maxDepth, 10)
    : Math.min(maxDepth, permissions.max_crawl_pages);

  console.log(
    `[datasetCrawl] Starting crawl for dataset ${datasetId} (user=${userId}, plan=${planId}, internal=${isInternalUser})`,
  );
  console.log(
    `[datasetCrawl] Options: requestedDepth=${maxDepth}, effectiveDepth=${effectiveMaxDepth}, concurrency=${concurrency}`,
  );

  // 3. Load queued jobs (global queue, but we'll only run jobs for this dataset)
  // We filter by businesses.dataset_id to keep this dataset isolated.
  const jobsResult = await pool.query<
    CrawlJobRecord & { business_int_id: number; dataset_id: string }
  >(
    `
    SELECT 
      cj.*,
      b.id::int AS business_int_id,
      b.dataset_id
    FROM crawl_jobs cj
    JOIN businesses b 
      ON b.id::text = cj.business_id
    WHERE cj.status = 'queued'
      AND b.dataset_id = $1
    ORDER BY cj.created_at ASC
    `,
    [datasetId],
  );

  const jobs = jobsResult.rows;

  if (jobs.length === 0) {
    console.log(
      `[datasetCrawl] No queued crawl jobs for dataset ${datasetId}. Nothing to do.`,
    );
    return;
  }

  console.log(
    `[datasetCrawl] Found ${jobs.length} queued crawl jobs for dataset ${datasetId}`,
  );

  // 4. Simple concurrency pool
  const maxConcurrency = Math.max(1, Math.min(concurrency, 10));
  let active = 0;
  let index = 0;

  async function runNext(): Promise<void> {
    if (index >= jobs.length) {
      return;
    }

    const job = jobs[index++];
    active += 1;

    try {
      await runSingleJob(job, datasetId, userId, effectiveMaxDepth);
    } finally {
      active -= 1;
      if (index < jobs.length) {
        await runNext();
      }
    }
  }

  const starters: Promise<void>[] = [];
  for (let i = 0; i < maxConcurrency && i < jobs.length; i++) {
    starters.push(runNext());
  }

  await Promise.all(starters);

  console.log(
    `[datasetCrawl] Completed crawl jobs for dataset ${datasetId} (processed=${jobs.length})`,
  );
}

/**
 * Run a single crawl job with status transitions + logging.
 */
async function runSingleJob(
  job: CrawlJobRecord & { business_int_id: number; dataset_id: string },
  datasetId: string,
  userId: string,
  effectiveMaxDepth: number,
): Promise<void> {
  const businessId = job.business_int_id;
  const websiteUrl = job.website_url;
  const jobId = job.id;

  console.log(
    `[datasetCrawl] Starting job ${jobId} for business ${businessId} (${websiteUrl})`,
  );

  await markCrawlJobRunning(jobId);

  try {
    const result = await crawlWorkerV1({
      businessId,
      datasetId,
      websiteUrl,
      userId,
    });

    if (result.success) {
      await markCrawlJobSuccess(jobId, result.pages_visited);
      logCrawlAction({
        userId,
        datasetId,
        resultSummary: `Crawl success for business ${businessId} (${websiteUrl}) - pages=${result.pages_visited}, emails=${result.emails_found}, phones=${result.phones_found}`,
        gated: result.gated,
        error: result.error,
        metadata: {
          job_id: jobId,
          business_id: businessId,
          website_url: websiteUrl,
          pages_visited: result.pages_visited,
          pages_limit: result.pages_limit,
          crawl_status: result.crawl_status,
          emails_found: result.emails_found,
          phones_found: result.phones_found,
          contact_pages_found: result.contact_pages_found,
          upgrade_hint: result.upgrade_hint,
        },
      });
      console.log(
        `[datasetCrawl] ✅ Job ${jobId} success for business ${businessId} (${websiteUrl})`,
      );
    } else {
      await markCrawlJobFailed(
        jobId,
        result.pages_visited,
        result.error || 'Unknown error',
      );
      logCrawlAction({
        userId,
        datasetId,
        resultSummary: `Crawl failed for business ${businessId} (${websiteUrl}) - ${result.error}`,
        gated: result.gated,
        error: result.error,
        metadata: {
          job_id: jobId,
          business_id: businessId,
          website_url: websiteUrl,
          pages_visited: result.pages_visited,
          pages_limit: result.pages_limit,
          crawl_status: result.crawl_status,
          emails_found: result.emails_found,
          phones_found: result.phones_found,
          contact_pages_found: result.contact_pages_found,
          upgrade_hint: result.upgrade_hint,
        },
      });
      console.warn(
        `[datasetCrawl] ⚠️ Job ${jobId} failed for business ${businessId}: ${result.error}`,
      );
    }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    await markCrawlJobFailed(jobId, job.pages_crawled || 0, message);
    logCrawlAction({
      userId,
      datasetId,
      resultSummary: `Crawl exception for business ${businessId} (${websiteUrl}) - ${message}`,
      gated: false,
      error: message,
      metadata: {
        job_id: jobId,
        business_id: businessId,
        website_url: websiteUrl,
      },
    });
    console.error(
      `[datasetCrawl] ❌ Job ${jobId} exception for business ${businessId}: ${message}`,
    );
  }
}

