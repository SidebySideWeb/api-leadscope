/**
 * Shared Business Database Functions
 * 
 * This module handles businesses as global, reusable assets.
 * Businesses are deduplicated globally by google_place_id.
 * Datasets reference businesses via dataset_businesses junction table.
 */

import { pool } from '../config/database.js';
import type { Business } from '../types/index.js';
import { normalizeBusinessName } from '../utils/normalizeBusinessName.js';
import type { GooglePlaceResult } from '../types/index.js';

/**
 * Search businesses in database by industry_id and city_id
 * Returns businesses in GooglePlaceResult format for compatibility
 * This is the PRIMARY discovery method - check DB first before external sources
 */
export async function searchBusinessesInDatabase(
  industryId: string,
  cityId: string,
  limit?: number
): Promise<GooglePlaceResult[]> {
  // Query businesses with aggregated contacts and websites
  const query = `
    SELECT DISTINCT ON (b.id)
      b.id,
      b.name,
      b.normalized_name,
      b.address,
      b.postal_code,
      b.city_id,
      b.industry_id,
      b.google_place_id,
      b.latitude,
      b.longitude,
      b.rating,
      b.user_rating_count,
      (
        SELECT w.url 
        FROM websites w 
        WHERE w.business_id = b.id 
        LIMIT 1
      ) as website,
      (
        SELECT c.phone 
        FROM contact_sources cs
        JOIN contacts c ON c.id = cs.contact_id
        WHERE cs.business_id = b.id::text 
          AND c.contact_type IN ('phone', 'mobile')
          AND c.phone IS NOT NULL
        LIMIT 1
      ) as phone,
      (
        SELECT c.email 
        FROM contact_sources cs
        JOIN contacts c ON c.id = cs.contact_id
        WHERE cs.business_id = b.id::text 
          AND c.contact_type = 'email'
          AND c.email IS NOT NULL
        LIMIT 1
      ) as email
    FROM businesses b
    WHERE b.industry_id = $1
      AND b.city_id = $2
      AND b.is_active = TRUE
    ORDER BY b.id, b.created_at DESC
    ${limit ? `LIMIT ${limit}` : ''}
  `;

  const result = await pool.query(query, [industryId, cityId]);
  
  // Convert to GooglePlaceResult format
  const businesses: GooglePlaceResult[] = [];

  for (const row of result.rows) {
    // Build address components
    const addressComponents: Array<{
      types: string[];
      long_name: string;
      short_name: string;
    }> = [];

    if (row.address) {
      // Try to parse address into components
      const addressParts = row.address.split(',');
      if (addressParts.length > 0) {
        addressComponents.push({
          types: ['street_address'],
          long_name: addressParts[0].trim(),
          short_name: addressParts[0].trim(),
        });
      }
      if (addressParts.length > 1) {
        addressComponents.push({
          types: ['locality'],
          long_name: addressParts[1].trim(),
          short_name: addressParts[1].trim(),
        });
      }
    }

    if (row.postal_code) {
      addressComponents.push({
        types: ['postal_code'],
        long_name: row.postal_code,
        short_name: row.postal_code,
      });
    }

    businesses.push({
      place_id: row.google_place_id || `db_${row.id}`, // Use DB ID if no google_place_id
      name: row.name,
      formatted_address: row.address || '',
      website: row.website || undefined,
      international_phone_number: row.phone || undefined,
      address_components: addressComponents.length > 0 ? addressComponents : undefined,
      rating: row.rating || undefined,
      user_rating_count: row.user_rating_count || undefined,
      latitude: row.latitude || undefined,
      longitude: row.longitude || undefined,
      // Store DB ID and email for reference
      _db_id: row.id,
      _db_email: row.email || undefined,
    } as GooglePlaceResult & { _db_id?: number; _db_email?: string });
  }

  return businesses;
}

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
 */
export async function upsertBusinessGlobal(data: {
  name: string;
  normalized_name?: string;
  address: string | null;
  postal_code: string | null;
  city_id: string;
  industry_id: string;
  dataset_id: string;
  google_place_id: string;
  owner_user_id?: string;
  discovery_run_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rating?: number | null;
  user_rating_count?: number | null;
}): Promise<{ business: Business; wasUpdated: boolean; wasNew: boolean }> {
  if (!data.city_id || data.city_id.trim().length === 0) {
    throw new Error(`Invalid business insert: missing city_id for business "${data.name}"`);
  }
  if (!data.industry_id || data.industry_id.trim().length === 0) {
    throw new Error(`Invalid business insert: missing industry_id for business "${data.name}"`);
  }
  if (!data.dataset_id || data.dataset_id.trim().length === 0) {
    throw new Error(`Invalid business insert: missing dataset_id for business "${data.name}"`);
  }
  if (!data.owner_user_id || data.owner_user_id.trim().length === 0) {
    throw new Error(`Invalid business insert: missing owner_user_id for business "${data.name}"`);
  }
  if (!data.google_place_id) {
    throw new Error('google_place_id is required for global business upsert');
  }

  let normalized_name: string;
  if (data.normalized_name) {
    normalized_name = data.normalized_name;
  } else {
    if (!data.name) {
      throw new Error('Cannot generate normalized_name without name');
    }
    normalized_name = normalizeBusinessName(data.name);
  }
  
  if (!normalized_name || normalized_name.trim().length === 0) {
    throw new Error(`Failed to generate normalized_name for business "${data.name}"`);
  }

  const insertValues = [
    data.name,
    normalized_name,
    data.address,
    data.postal_code,
    data.city_id,
    data.industry_id,
    data.dataset_id,
    data.google_place_id,
    data.owner_user_id,
    data.discovery_run_id || null,
    data.latitude || null,
    data.longitude || null
  ];

  try {
    const existingByNormalizedName = await pool.query<Business>(
      `SELECT * FROM businesses 
       WHERE dataset_id = $1 AND normalized_name = $2 
       LIMIT 1`,
      [data.dataset_id, normalized_name]
    );

    let result;
    if (existingByNormalizedName.rows.length > 0) {
      const existing = existingByNormalizedName.rows[0];
      result = await pool.query<Business>(
        `UPDATE businesses SET
          name = $1,
          normalized_name = $2,
          address = COALESCE($3, address),
          postal_code = COALESCE($4, postal_code),
          city_id = $5,
          industry_id = $6,
          dataset_id = $7,
          google_place_id = COALESCE($8, google_place_id),
          discovery_run_id = COALESCE($9::uuid, discovery_run_id),
          latitude = COALESCE($10, latitude),
          longitude = COALESCE($11, longitude),
          last_discovered_at = NOW(),
          updated_at = NOW()
         WHERE id = $12
         RETURNING *`,
        [...insertValues.slice(0, 11), existing.id]
      );
    } else {
      try {
        result = await pool.query<Business>(
          `INSERT INTO businesses (
            name, normalized_name, address, postal_code, city_id, 
            industry_id, dataset_id, google_place_id, owner_user_id, discovery_run_id, latitude, longitude,
            last_discovered_at, crawl_status, created_at, updated_at
          )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid, $11, $12, NOW(), 'pending', NOW(), NOW())
           ON CONFLICT (google_place_id) 
           DO UPDATE SET
             name = EXCLUDED.name,
             normalized_name = EXCLUDED.normalized_name,
             address = COALESCE(EXCLUDED.address, businesses.address),
             postal_code = COALESCE(EXCLUDED.postal_code, businesses.postal_code),
             city_id = EXCLUDED.city_id,
             industry_id = EXCLUDED.industry_id,
             dataset_id = EXCLUDED.dataset_id,
             discovery_run_id = COALESCE(EXCLUDED.discovery_run_id::uuid, businesses.discovery_run_id),
             latitude = COALESCE(EXCLUDED.latitude, businesses.latitude),
             longitude = COALESCE(EXCLUDED.longitude, businesses.longitude),
             last_discovered_at = NOW(),
             updated_at = NOW()
           RETURNING *`,
          insertValues
        );
      } catch (insertError: any) {
        if (insertError.code === '23505' && insertError.constraint === 'businesses_dataset_normalized_unique') {
          const existingByNormalizedName = await pool.query<Business>(
            `SELECT * FROM businesses 
             WHERE dataset_id = $1 AND normalized_name = $2 
             LIMIT 1`,
            [data.dataset_id, normalized_name]
          );
          
          if (existingByNormalizedName.rows.length > 0) {
            const existing = existingByNormalizedName.rows[0];
            result = await pool.query<Business>(
              `UPDATE businesses SET
                name = $1,
                normalized_name = $2,
                address = COALESCE($3, address),
                postal_code = COALESCE($4, postal_code),
                city_id = $5,
                industry_id = $6,
                dataset_id = $7,
                google_place_id = COALESCE($8, google_place_id),
                discovery_run_id = COALESCE($9::uuid, discovery_run_id),
                latitude = COALESCE($10, latitude),
                longitude = COALESCE($11, longitude),
                last_discovered_at = NOW(),
                updated_at = NOW()
               WHERE id = $12
               RETURNING *`,
              [...insertValues.slice(0, 11), existing.id]
            );
          } else {
            throw insertError;
          }
        } else {
          throw insertError;
        }
      }
    }

    if (result.rows.length === 0) {
      throw new Error(`Failed to upsert business with google_place_id: ${data.google_place_id}`);
    }

    const business = result.rows[0];
    const createdAt = new Date(business.created_at).getTime();
    const updatedAt = new Date(business.updated_at).getTime();
    const wasUpdated = (updatedAt - createdAt) > 1000;
    const wasNew = !wasUpdated;

    await recalculateDataCompletenessScore(business.id);

    return { business, wasUpdated, wasNew };
  } catch (error: any) {
    const enhancedError = new Error(
      `Failed to upsert business "${data.name}": ${error.message} (code: ${error.code || 'unknown'})`
    );
    (enhancedError as any).originalError = error;
    (enhancedError as any).code = error.code;
    throw enhancedError;
  }
}

/**
 * Link business to dataset via dataset_businesses junction table
 * 
 * Note: Enforcement for dataset size should be done BEFORE calling this function
 * Use enforceDatasetSize() from enforcementService if needed
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
 */
export async function recalculateDataCompletenessScore(businessId: number): Promise<number> {
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
        WHERE cs.business_id::text = b.id::text
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
  let score = 0;
  
  if (business.website) {
    score += 40;
  }
  
  const hasEmail = (business.emails && Array.isArray(business.emails) && business.emails.length > 0) 
    || business.has_email_from_contacts;
  if (hasEmail) {
    score += 30;
  }
  
  const phoneResult = await pool.query<{ has_phone: boolean }>(
    `SELECT EXISTS (
      SELECT 1 
      FROM contact_sources cs
      JOIN contacts c ON c.id = cs.contact_id
      WHERE cs.business_id::text = $1::text
        AND (c.phone IS NOT NULL OR c.mobile IS NOT NULL)
    ) as has_phone`,
    [businessId]
  );
  const hasPhone = business.phone || phoneResult.rows[0]?.has_phone;
  if (hasPhone) {
    score += 20;
  }
  
  if (business.address) {
    score += 10;
  }

  await pool.query(
    'UPDATE businesses SET data_completeness_score = $1 WHERE id = $2',
    [score, businessId]
  );

  return score;
}

/**
 * Check if business needs crawling based on TTL
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
  if (!business.website) {
    return false;
  }
  if (!business.last_crawled_at) {
    return true;
  }

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
