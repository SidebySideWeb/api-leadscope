import { pool } from '../config/database.js';
import type { Business } from '../types/index.js';
import { computeNormalizedBusinessId } from '../utils/normalize.js';

/**
 * Get business by Google Place ID within a specific dataset
 * This prevents cross-dataset contamination
 */
export async function getBusinessByGooglePlaceId(
  google_place_id: string,
  dataset_id: string
): Promise<Business | null> {
  const result = await pool.query<Business>(
    'SELECT * FROM businesses WHERE google_place_id = $1 AND dataset_id = $2',
    [google_place_id, dataset_id]
  );
  return result.rows[0] || null;
}

/**
 * Get business by normalized name within a specific dataset
 * Used for duplicate detection on (dataset_id, normalized_name)
 */
export async function getBusinessByNormalizedName(
  normalized_name: string,
  dataset_id: string
): Promise<Business | null> {
  const result = await pool.query<Business>(
    'SELECT * FROM businesses WHERE normalized_name = $1 AND dataset_id = $2',
    [normalized_name, dataset_id]
  );
  return result.rows[0] || null;
}

/**
 * Upsert business: Insert if new, Update if exists
 * 
 * This is the primary function for syncing businesses:
 * - If business exists (by google_place_id or normalized_name) → UPDATE
 * - If business doesn't exist → INSERT
 * 
 * Used for:
 * - Monthly sync/refresh
 * - New crawl from new client
 */
export async function upsertBusiness(data: {
  name: string;
  address: string | null;
  postal_code: string | null;
  city_id: number;
  industry_id: number | null;
  google_place_id: string | null;
  dataset_id: string; // UUID
  owner_user_id: string;
}): Promise<{ business: Business; wasUpdated: boolean }> {
  // Compute normalized name BEFORE insert/update
  const normalized_name = computeNormalizedBusinessId({
    name: data.name,
    googlePlaceId: data.google_place_id
  });

  // Try to insert, handling conflicts on (dataset_id, normalized_name)
  // On conflict: UPDATE existing business with fresh data
  const result = await pool.query<Business>(
    `INSERT INTO businesses (
      name, normalized_name, address, postal_code, city_id, 
      industry_id, google_place_id, dataset_id, owner_user_id,
      created_at, updated_at
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     ON CONFLICT (dataset_id, normalized_name) 
     DO UPDATE SET
       name = EXCLUDED.name,
       address = EXCLUDED.address,
       postal_code = EXCLUDED.postal_code,
       city_id = EXCLUDED.city_id,
       industry_id = EXCLUDED.industry_id,
       google_place_id = COALESCE(EXCLUDED.google_place_id, businesses.google_place_id),
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
      data.dataset_id,
      data.owner_user_id
    ]
  );

  if (result.rows.length === 0) {
    throw new Error(`Failed to upsert business with normalized_name: ${normalized_name}`);
  }

  const business = result.rows[0];
  
  // Check if this was an update by comparing created_at vs updated_at
  // If they're very close (< 1 second), it was likely an insert
  const createdAt = new Date(business.created_at).getTime();
  const updatedAt = new Date(business.updated_at).getTime();
  const wasUpdated = (updatedAt - createdAt) > 1000; // More than 1 second difference

  if (wasUpdated) {
    console.log(`[upsertBusiness] UPDATED existing business:`, {
      business_id: business.id,
      normalized_name: business.normalized_name,
      dataset_id: business.dataset_id
    });
  } else {
    console.log(`[upsertBusiness] INSERTED new business:`, {
      business_id: business.id,
      normalized_name: business.normalized_name,
      dataset_id: business.dataset_id
    });
  }

  return { business, wasUpdated };
}

/**
 * Legacy createBusiness function - now uses upsertBusiness internally
 * Maintained for backward compatibility
 */
export async function createBusiness(data: {
  name: string;
  address: string | null;
  postal_code: string | null;
  city_id: number;
  industry_id: number | null;
  google_place_id: string | null;
  dataset_id: string; // UUID
  owner_user_id: string;
}): Promise<Business> {
  const { business } = await upsertBusiness(data);
  return business;
}

export async function updateBusiness(id: number, data: {
  name?: string;
  address?: string | null;
  postal_code?: string | null;
  city_id?: number;
  industry_id?: number | null;
}): Promise<Business> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.name !== undefined) {
    // Normalize and validate name (never empty; falls back to id if needed)
    // This is computed BEFORE update to ensure consistency
    const normalized_name = computeNormalizedBusinessId({
      name: data.name,
      businessId: id
    });
    updates.push(`name = $${paramCount++}`, `normalized_name = $${paramCount++}`);
    values.push(data.name, normalized_name);
    
    console.log(`[updateBusiness] Updating name:`, {
      business_id: id,
      name: data.name,
      normalized_name
    });
  }
  if (data.address !== undefined) {
    updates.push(`address = $${paramCount++}`);
    values.push(data.address);
  }
  if (data.postal_code !== undefined) {
    updates.push(`postal_code = $${paramCount++}`);
    values.push(data.postal_code);
  }
  if (data.city_id !== undefined) {
    updates.push(`city_id = $${paramCount++}`);
    values.push(data.city_id);
  }
  if (data.industry_id !== undefined) {
    updates.push(`industry_id = $${paramCount++}`);
    values.push(data.industry_id);
  }

  // Always update updated_at (trigger will also set it, but explicit is safer)
  // Note: updated_at is set by trigger, but we include it for clarity
  updates.push(`updated_at = NOW()`);
  values.push(id);

  if (updates.length === 1) {
    // Only updated_at, no other changes
    const result = await pool.query<Business>(
      `UPDATE businesses SET updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      throw new Error(`Business with id ${id} not found`);
    }
    return result.rows[0];
  }

  const result = await pool.query<Business>(
    `UPDATE businesses SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );
  
  if (result.rows.length === 0) {
    throw new Error(`Business with id ${id} not found`);
  }
  
  return result.rows[0];
}

/**
 * Get all businesses that need monthly refresh
 * Returns businesses that haven't been updated in the last 30 days
 */
export async function getBusinessesNeedingRefresh(
  datasetId?: string
): Promise<Business[]> {
  const query = datasetId
    ? `SELECT * FROM businesses 
       WHERE dataset_id = $1 
         AND (updated_at < NOW() - INTERVAL '30 days' OR updated_at IS NULL)
       ORDER BY updated_at ASC NULLS FIRST
       LIMIT 1000`
    : `SELECT * FROM businesses 
       WHERE updated_at < NOW() - INTERVAL '30 days' OR updated_at IS NULL
       ORDER BY updated_at ASC NULLS FIRST
       LIMIT 1000`;
  
  const params = datasetId ? [datasetId] : [];
  const result = await pool.query<Business>(query, params);
  return result.rows;
}
