/**
 * Crawl Worker - Processes queued crawl jobs
 * 
 * This worker:
 * 1. Fetches queued crawl jobs (new schema with business_id and website_url)
 * 2. Crawls the websites
 * 3. Stores pages in crawl_pages table
 * 4. Updates crawl job status
 * 
 * The extraction worker then reads these pages to extract emails/phones
 */

import { 
  getQueuedCrawlJobs, 
  markCrawlJobRunning, 
  markCrawlJobSuccess, 
  markCrawlJobFailed,
  incrementPagesCrawled,
  type CrawlJobRecord 
} from '../db/crawlJobs.js';
import { crawlWebsite } from './crawlerWorker.js';
import type { Website, CrawlJob } from '../types/index.js';

/**
 * Process a single crawl job (new schema)
 */
async function processCrawlJob(job: CrawlJobRecord): Promise<void> {
  console.log(`[crawlWorker] Processing crawl job ${job.id} for business ${job.business_id}, website ${job.website_url}`);
  
  try {
    // Mark job as running
    await markCrawlJobRunning(job.id);
    
    // Create Website-like object for crawlWebsite function
    // Note: crawlWebsite expects legacy Website type, but we're using new schema
    const website: Website = {
      id: 0, // Not used in new schema (legacy field)
      url: job.website_url,
      business_id: null, // Legacy field - not used by crawlWebsite
      last_crawled_at: null,
      html_hash: null,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    // Create CrawlJob-like object for crawlWebsite function
    // Note: crawlWebsite expects legacy CrawlJob type, but we're using new schema
    const crawlJob: CrawlJob = {
      id: job.id,
      website_id: 0, // Not used in new schema (legacy field)
      status: 'running', // Legacy status - will be updated by markCrawlJobSuccess/Failed
      pages_crawled: job.pages_crawled,
      pages_limit: job.pages_limit,
      job_type: 'discovery',
      error_message: null,
      started_at: new Date(),
      completed_at: null,
      created_at: job.created_at
    };

    // Crawl website - this stores pages in crawl_pages (used by extraction worker)
    const crawlResults = await crawlWebsite(website, crawlJob);
    
    // Update pages crawled count
    await incrementPagesCrawled(job.id, crawlResults.length);
    
    if (crawlResults.length > 0) {
      console.log(`[crawlWorker] Successfully processed crawl job ${job.id}: ${crawlResults.length} pages crawled`);
      await markCrawlJobSuccess(job.id, crawlResults.length);
    } else {
      console.warn(`[crawlWorker] Crawl job ${job.id} completed with 0 pages (crawling failed or no pages found) - extraction worker will fallback to Place Details API`);
      await markCrawlJobSuccess(job.id, 0); // Still mark as success even with 0 pages
    }
    
    // After crawling completes, ensure extraction job exists and is reset to 'pending'
    // This allows extraction worker to re-process with the newly crawled pages
    // Note: Even if 0 pages were crawled, we still reset extraction job so it can fallback to Place Details API
    try {
      const { pool } = await import('../config/database.js');
      // Create or reset extraction job to 'pending' so it gets re-processed
      // This is important even if crawling failed (0 pages) - extraction worker will fallback to Place Details
      await pool.query(
        `INSERT INTO extraction_jobs (business_id, status)
         VALUES ($1, 'pending')
         ON CONFLICT (business_id) 
         DO UPDATE SET status = 'pending', error_message = NULL, started_at = NULL, completed_at = NULL`,
        [job.business_id]
      );
      if (crawlResults.length > 0) {
        console.log(`[crawlWorker] Created/reset extraction job for business ${job.business_id} after crawl completion (${crawlResults.length} pages)`);
      } else {
        console.log(`[crawlWorker] Created/reset extraction job for business ${job.business_id} - extraction worker will fallback to Place Details API (0 pages crawled)`);
      }
    } catch (error: any) {
      // Don't fail crawl job if extraction job creation fails
      console.error(`[crawlWorker] Error creating/resetting extraction job for business ${job.business_id}:`, error.message);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[crawlWorker] Error processing crawl job ${job.id}:`, errorMsg);
    
    await markCrawlJobFailed(job.id, job.pages_crawled, errorMsg);
    throw error;
  }
}

/**
 * Process a batch of crawl jobs (new schema)
 */
export async function runCrawlBatch(batchSize: number = 5): Promise<void> {
  try {
    const jobs = await getQueuedCrawlJobs(batchSize);
    
    if (jobs.length === 0) {
      // Log periodically so we know the worker is running
      const now = new Date();
      if (now.getSeconds() % 30 === 0) { // Log every 30 seconds
        console.log(`[crawlWorker] No queued crawl jobs found`);
      }
      return;
    }

    console.log(`[crawlWorker] Found ${jobs.length} queued crawl jobs - processing...`);
    
    for (const job of jobs) {
      try {
        await processCrawlJob(job);
      } catch (error) {
        // Continue processing other jobs even if one fails
        console.error(`[crawlWorker] Failed to process crawl job ${job.id}, continuing...`);
      }
    }
    
    console.log(`[crawlWorker] Completed batch: processed ${jobs.length} crawl jobs`);
  } catch (error) {
    console.error('[crawlWorker] Error in crawl batch:', error);
    throw error;
  }
}
