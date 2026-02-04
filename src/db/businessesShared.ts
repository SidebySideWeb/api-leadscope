/**
 * Shared Business Database Functions
 * 
 * This module handles businesses as global, reusable assets.
 * Businesses are deduplicated globally by google_place_id.
 * Datasets reference businesses via dataset_businesses junction table.
 */

import { pool } from '../config/database.js';
import type { Business } from '../types/index.js';
import { computeNormalizedBusinessId } from '../utils/normalize.js';

/**
 * Get business by Google Place ID (global lookup, not per-dataset)
 */
export async function getBusinessByGooglePlaceIdGlobal(
  google_place_id: string
): Promise<Business | null> {
  const result = await pool.query<Business>(
    'SELECT * FROM businesses WHERE google_place_id = $1 LIMIT 1',
    [google_place_id]
  );
  return result.rows[0] || null;
}

/**
 * Upsert business globally by google_place_id
 * 
 * This is the core function for discovery - it ensures businesses are:
 * - Unique globally (by google_place_id)
 * - Enriched with latest metadata
 * - Never duplicated
 * 
 * Behavior:
 * - If business exists (by google_place_id) → UPDATE metadata, set last_discovered_at
 * - If business is new → INSERT with crawl_status = 'pending'
 * 
 * Discovery MUST NOT:
 * - Trigger crawling
 * - Fetch Place Details
 * - Fetch contact information
 */
export async function upsertBusinessGlobal(data: {
  name: string;
  address: string | null;
  postal_code: string | null;
  city_id: string; // UUID
  industry_id: string | null; // UUID
  google_place_id: string; // REQUIRED for global deduplication
  latitude?: number | null;
  longitude?: number | null;
  rating?: number | null;
  user_rating_count?: number | null;
}): Promise<{ business: Business; wasUpdated: boolean; wasNew: boolean }> {
  if (!data.google_place_id) {
    throw new Error('google_place_id is required for global business upsert');
  }

  // CRITICAL: normalized_name is NOT NULL in database - missing this causes silent rollbacks
  // Always generate normalized_name from business name using deterministic normalization
  const normalized_name = computeNormalizedBusinessId({
    name: data.name,
    googlePlaceId: data.google_place_id
  });
  
  // Ensure normalized_name is never empty (fallback to google_place_id if normalization fails)
  if (!normalized_name || normalized_name.trim().length === 0) {
    throw new Error(`Failed to generate normalized_name for business "${data.name}" - this will cause silent insert failures`);
  }

  // Try to insert, handling conflict on google_place_id
  const result = await pool.query<Business>(
    `INSERT INTO businesses (
      name, normalized_name, address, postal_code, city_id, 
      industry_id, google_place_id, latitude, longitude,
      last_discovered_at, crawl_status, created_at, updated_at
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'pending', NOW(), NOW())
     ON CONFLICT (google_place_id) 
     DO UPDATE SET
       name = EXCLUDED.name,
       normalized_name = EXCLUDED.normalized_name,
       address = COALESCE(EXCLUDED.address, businesses.address),
       postal_code = COALESCE(EXCLUDED.address, businesses.postal_code),
       city_id = COALESCE(EXCLUDED.city_id, businesses.city_id),
       industry_id = COALESCE(EXCLUDED.industry_id, businesses.industry_id),
       latitude = COALESCE(EXCLUDED.latitude, businesses.latitude),
       longitude = COALESCE(EXCLUDED.longitude, businesses.longitude),
       last_discovered_at = NOW(), -- Always update discovery timestamp
       updated_at = NOW()
     RETURNING *`,
    [
      data.name,
      normalized_name,
      data.address,
      data.postal_code,
      data.city_id,
      data.industry_id,
      data.google_place_id,
      data.latitude || null,
      data.longitude || null
    ]
  );

  if (result.rows.length === 0) {
    throw new Error(`Failed to upsert business with google_place_id: ${data.google_place_id}`);
  }

  const business = result.rows[0];
  
  // Check if this was an update or insert
  const createdAt = new Date(business.created_at).getTime();
  const updatedAt = new Date(business.updated_at).getTime();
  const wasUpdated = (updatedAt - createdAt) > 1000; // More than 1 second difference
  const wasNew = !wasUpdated;

  // Recalculate data completeness score after upsert
  await recalculateDataCompletenessScore(business.id);

  return { business, wasUpdated, wasNew };
}

/**
 * Link business to dataset via dataset_businesses junction table
 * 
 * This creates the many-to-many relationship between datasets and businesses.
 * Datasets are views over businesses, not data owners.
 */
export async function linkBusinessToDataset(
  businessId: number,
  datasetId: string,
  userId?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO dataset_businesses (dataset_id, business_id, added_by_user_id, manually_included)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (dataset_id, business_id) DO NOTHING`,
    [datasetId, businessId, userId || null]
  );
}

/**
 * Recalculate data completeness score for a business
 * 
 * Scoring:
 * - Website present: +40
 * - Email present: +30
 * - Phone present: +20
 * - Address present: +10
 * 
 * Total: 0-100
 * 
 * Called after:
 * - Discovery (updates metadata)
 * - Crawling (updates contacts)
 * - Place Details fetch (updates website/phone)
 */
export async function recalculateDataCompletenessScore(businessId: number): Promise<number> {
  // Get business data (check both businesses table and related tables)
  const businessResult = await pool.query<{
    website: string | null;
    phone: string | null;
    address: string | null;
    emails: any;
    has_email_from_contacts: boolean;
  }>(
    `SELECT 
      b.website,
      b.phone,
      b.address,
      b.emails,
      EXISTS (
        SELECT 1 
        FROM contact_sources cs
        JOIN contacts c ON c.id = cs.contact_id
        WHERE cs.business_id = b.id::text
          AND c.email IS NOT NULL
      ) as has_email_from_contacts
     FROM businesses b
     WHERE b.id = $1`,
    [businessId]
  );

  if (businessResult.rows.length === 0) {
    return 0;
  }

  const business = businessResult.rows[0];
  
  // Calculate score
  let score = 0;
  
  // Website: +40
  if (business.website) {
    score += 40;
  }
  
  // Email: +30 (check both businesses.emails JSONB and contacts table)
  const hasEmail = (business.emails && Array.isArray(business.emails) && business.emails.length > 0) 
    || business.has_email_from_contacts;
  if (hasEmail) {
    score += 30;
  }
  
  // Phone: +20 (check both businesses.phone and contacts table)
  const phoneResult = await pool.query<{ has_phone: boolean }>(
    `SELECT EXISTS (
      SELECT 1 
      FROM contact_sources cs
      JOIN contacts c ON c.id = cs.contact_id
      WHERE cs.business_id = $1::text
        AND (c.phone IS NOT NULL OR c.mobile IS NOT NULL)
    ) as has_phone`,
    [businessId]
  );
  const hasPhone = business.phone || phoneResult.rows[0]?.has_phone;
  if (hasPhone) {
    score += 20;
  }
  
  // Address: +10
  if (business.address) {
    score += 10;
  }

  // Update score
  await pool.query(
    'UPDATE businesses SET data_completeness_score = $1 WHERE id = $2',
    [score, businessId]
  );

  return score;
}

/**
 * Check if business needs crawling based on TTL
 * 
 * Crawl if:
 * - website IS NOT NULL
 * - AND (last_crawled_at IS NULL OR last_crawled_at < now() - 45 days)
 */
export async function shouldCrawlBusiness(businessId: number): Promise<boolean> {
  const result = await pool.query<{
    website: string | null;
    last_crawled_at: Date | null;
  }>(
    `SELECT website, last_crawled_at 
     FROM businesses 
     WHERE id = $1`,
    [businessId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  const business = result.rows[0];

  // No website = skip crawling
  if (!business.website) {
    return false;
  }

  // Never crawled = needs crawling
  if (!business.last_crawled_at) {
    return true;
  }

  // Check TTL (45 days)
  const daysSinceCrawl = (Date.now() - new Date(business.last_crawled_at).getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceCrawl >= 45;
}

/**
 * Get businesses that need crawling (TTL-based)
 */
export async function getBusinessesNeedingCrawl(
  limit: number = 100
): Promise<Business[]> {
  const result = await pool.query<Business>(
    `SELECT b.*
     FROM businesses b
     WHERE b.website IS NOT NULL
       AND (
         b.last_crawled_at IS NULL
         OR b.last_crawled_at < NOW() - INTERVAL '45 days'
       )
       AND b.crawl_status != 'skipped'
     ORDER BY b.last_crawled_at ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  );

  return result.rows;
}
