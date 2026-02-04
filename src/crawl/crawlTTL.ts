/**
 * TTL-Based Crawling Logic
 * 
 * Implements crawling rules based on data freshness:
 * - Crawl only if website exists
 * - Crawl only if last_crawled_at is NULL or > 45 days old
 * - Update crawl_status and last_crawled_at after crawling
 */

import { pool } from '../config/database.js';
import { shouldCrawlBusiness, getBusinessesNeedingCrawl } from '../db/businessesShared.js';

/**
 * Check if business should be crawled based on TTL
 * 
 * Rules:
 * - website IS NOT NULL
 * - AND (last_crawled_at IS NULL OR last_crawled_at < now() - 45 days)
 */
export async function shouldCrawlBusinessByTTL(businessId: number): Promise<boolean> {
  return await shouldCrawlBusiness(businessId);
}

/**
 * Get businesses that need crawling (TTL-based)
 */
export async function getBusinessesNeedingCrawlByTTL(limit: number = 100): Promise<number[]> {
  const businesses = await getBusinessesNeedingCrawl(limit);
  return businesses.map(b => b.id);
}

/**
 * Mark business as crawled (update TTL tracking)
 * 
 * Called after successful crawl to update:
 * - last_crawled_at
 * - crawl_status
 */
export async function markBusinessCrawled(
  businessId: number,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  await pool.query(
    `UPDATE businesses
     SET last_crawled_at = NOW(),
         crawl_status = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [success ? 'success' : 'failed', businessId]
  );

  if (!success && errorMessage) {
    // Log error (could store in separate error log table)
    console.error(`[markBusinessCrawled] Business ${businessId} crawl failed: ${errorMessage}`);
  }
}

/**
 * Mark business crawl as skipped
 * 
 * Used when business has no website or crawl is not needed
 */
export async function markBusinessCrawlSkipped(businessId: number, reason: string): Promise<void> {
  await pool.query(
    `UPDATE businesses
     SET crawl_status = 'skipped',
         updated_at = NOW()
     WHERE id = $1`,
    [businessId]
  );

  console.log(`[markBusinessCrawlSkipped] Business ${businessId} skipped: ${reason}`);
}

/**
 * Check if business needs crawling before export
 * 
 * Returns true if:
 * - Business has website
 * - AND (never crawled OR crawled > 45 days ago)
 */
export async function needsCrawlForExport(businessId: number): Promise<boolean> {
  return await shouldCrawlBusiness(businessId);
}
