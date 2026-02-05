/**
 * Crawl Worker - Processes pending crawl jobs
 * 
 * This worker:
 * 1. Fetches pending crawl jobs
 * 2. Crawls the websites
 * 3. Stores pages in crawl_pages table
 * 4. Updates crawl job status
 * 
 * The extraction worker then reads these pages to extract emails/phones
 */

import { getPendingCrawlJobs, updateCrawlJob } from '../db/crawlJobs.js';
import { getWebsiteById } from '../db/websites.js';
import { crawlWebsite } from './crawlerWorker.js';
import type { Website, CrawlJob } from '../types/index.js';

/**
 * Process a single crawl job
 */
async function processCrawlJob(job: CrawlJob): Promise<void> {
  console.log(`[crawlWorker] Processing crawl job ${job.id} for website ${job.website_id}`);
  
  try {
    // Get website
    const website = await getWebsiteById(job.website_id);
    if (!website) {
      throw new Error(`Website ${job.website_id} not found`);
    }

    // Crawl website - this stores pages in both crawl_results and crawl_pages
    const crawlResults = await crawlWebsite(website, job);
    
    console.log(`[crawlWorker] Successfully processed crawl job ${job.id}: ${crawlResults.length} pages crawled`);
    
    // After crawling completes, ensure extraction job exists and is reset to 'pending'
    // This allows extraction worker to re-process with the newly crawled pages
    if (website.business_id && crawlResults.length > 0) {
      try {
        const { pool } = await import('../config/database.js');
        // Create or reset extraction job to 'pending' so it gets re-processed
        await pool.query(
          `INSERT INTO extraction_jobs (business_id, status)
           VALUES ($1, 'pending')
           ON CONFLICT (business_id) 
           DO UPDATE SET status = 'pending', error_message = NULL, started_at = NULL, completed_at = NULL`,
          [website.business_id]
        );
        console.log(`[crawlWorker] Created/reset extraction job for business ${website.business_id} after crawl completion`);
      } catch (error: any) {
        // Don't fail crawl job if extraction job creation fails
        console.error(`[crawlWorker] Error creating/resetting extraction job for business ${website.business_id}:`, error.message);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[crawlWorker] Error processing crawl job ${job.id}:`, errorMsg);
    
    await updateCrawlJob(job.id, {
      status: 'failed',
      error_message: errorMsg,
      completed_at: new Date()
    });
    throw error;
  }
}

/**
 * Process a batch of crawl jobs
 */
export async function runCrawlBatch(batchSize: number = 5): Promise<void> {
  try {
    const jobs = await getPendingCrawlJobs(batchSize);
    
    if (jobs.length === 0) {
      // Log periodically so we know the worker is running
      const now = new Date();
      if (now.getSeconds() % 30 === 0) { // Log every 30 seconds
        console.log(`[crawlWorker] No pending crawl jobs found`);
      }
      return;
    }

    console.log(`[crawlWorker] Found ${jobs.length} pending crawl jobs - processing...`);
    
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
