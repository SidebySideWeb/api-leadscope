import { pool } from '../config/database.js';
import type { Business } from '../types/index.js';
import { normalizeBusinessName } from '../utils/normalizeBusinessName.js';

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
  normalized_name?: string; // Optional - will be generated from name if missing
  address: string | null;
  postal_code: string | null;
  city_id: string; // UUID - REQUIRED (NOT NULL)
  industry_id: string; // UUID - REQUIRED (NOT NULL)
  google_place_id: string | null;
  dataset_id: string; // UUID - REQUIRED (NOT NULL)
  owner_user_id: string;
  discovery_run_id?: string | null; // UUID
}): Promise<{ business: Business; wasUpdated: boolean }> {
  // CRITICAL: Fail-fast guard - all required fields must be provided from discovery context
  if (!data.city_id || data.city_id.trim().length === 0) {
    throw new Error(`Invalid business insert: missing city_id for business "${data.name}" - City ID must be provided from discovery context`);
  }

  if (!data.industry_id || data.industry_id.trim().length === 0) {
    throw new Error(`Invalid business insert: missing industry_id for business "${data.name}" - Industry ID must be provided from discovery context`);
  }

  if (!data.dataset_id || data.dataset_id.trim().length === 0) {
    throw new Error(`Invalid business insert: missing dataset_id for business "${data.name}" - Dataset ID must be provided from discovery context`);
  }

  // CRITICAL: normalized_name is NOT NULL in database - missing this causes silent rollbacks
  // If normalized_name is provided → trust it
  // If missing → generate it internally using name
  // If both missing → throw a hard error
  let normalized_name: string;
  if (data.normalized_name) {
    // Trust provided normalized_name
    normalized_name = data.normalized_name;
  } else {
    if (!data.name) {
      throw new Error('Cannot generate normalized_name without name');
    }
    normalized_name = normalizeBusinessName(data.name);
  }
  
  // Ensure normalized_name is never empty
  if (!normalized_name || normalized_name.trim().length === 0) {
    throw new Error(`Failed to generate normalized_name for business "${data.name}" - this will cause silent insert failures`);
  }

  // DEBUG: Log database info before insert
  const dbInfo = await pool.query<{ db: string; user: string }>(
    `SELECT current_database() as db, current_user as user`
  );
  console.log('DB INFO FROM APP', dbInfo.rows[0]);

  // CRITICAL DEBUG: Log all values BEFORE INSERT to identify NOT NULL violations
  console.log('[upsertBusiness] ===== BEFORE INSERT =====');
  console.log('[upsertBusiness] Function: upsertBusiness');
  console.log('[upsertBusiness] File: src/db/businesses.ts');
  console.log('[upsertBusiness] name:', data.name);
  console.log('[upsertBusiness] normalized_name:', normalized_name);
  console.log('[upsertBusiness] city_id:', data.city_id);
  console.log('[upsertBusiness] google_place_id:', data.google_place_id);
  console.log('[upsertBusiness] dataset_id:', data.dataset_id);
  console.log('[upsertBusiness] owner_user_id:', data.owner_user_id);
  console.log('[upsertBusiness] discovery_run_id:', data.discovery_run_id);
  console.log('[upsertBusiness] Full data object:', JSON.stringify({
    name: data.name,
    normalized_name,
    city_id: data.city_id,
    google_place_id: data.google_place_id,
    dataset_id: data.dataset_id,
    owner_user_id: data.owner_user_id,
    discovery_run_id: data.discovery_run_id,
    address: data.address,
    postal_code: data.postal_code,
    industry_id: data.industry_id
  }, null, 2));
  console.log('[upsertBusiness] =========================');

  // Prepare parameter values for INSERT
  const insertValues = [
    data.name,
    normalized_name,
    data.address,
    data.postal_code,
    data.city_id,
    data.industry_id,
    data.google_place_id,
    data.dataset_id,
    data.owner_user_id,
    data.discovery_run_id || null
  ];

  // CRITICAL DEBUG: Log actual parameter values being passed to INSERT
  console.log('[upsertBusiness] INSERT VALUES ARRAY:');
  console.log('[upsertBusiness]   $1 (name):', insertValues[0], typeof insertValues[0]);
  console.log('[upsertBusiness]   $2 (normalized_name):', insertValues[1], typeof insertValues[1], insertValues[1] === null ? '⚠️ NULL!' : '', insertValues[1] === undefined ? '⚠️ UNDEFINED!' : '');
  console.log('[upsertBusiness]   $3 (address):', insertValues[2], typeof insertValues[2]);
  console.log('[upsertBusiness]   $4 (postal_code):', insertValues[3], typeof insertValues[3]);
  console.log('[upsertBusiness]   $5 (city_id):', insertValues[4], typeof insertValues[4], insertValues[4] === null ? '⚠️ NULL!' : '', insertValues[4] === undefined ? '⚠️ UNDEFINED!' : '');
  console.log('[upsertBusiness]   $6 (industry_id):', insertValues[5], typeof insertValues[5], insertValues[5] === null ? '⚠️ NULL!' : '', insertValues[5] === undefined ? '⚠️ UNDEFINED!' : '');
  console.log('[upsertBusiness]   $7 (google_place_id):', insertValues[6], typeof insertValues[6]);
  console.log('[upsertBusiness]   $8 (dataset_id):', insertValues[7], typeof insertValues[7], insertValues[7] === null ? '⚠️ NULL!' : '', insertValues[7] === undefined ? '⚠️ UNDEFINED!' : '');
  console.log('[upsertBusiness]   $9 (owner_user_id):', insertValues[8], typeof insertValues[8]);
  console.log('[upsertBusiness]   $10 (discovery_run_id):', insertValues[9], typeof insertValues[9]);

  try {
    // Try to insert, handling conflicts on (dataset_id, normalized_name)
    // On conflict: UPDATE existing business with fresh data
    // CRITICAL: discovery_run_id must be set if provided (never use COALESCE to keep old NULL)
    const result = await pool.query<Business>(
      `INSERT INTO businesses (
        name, normalized_name, address, postal_code, city_id, 
        industry_id, google_place_id, dataset_id, owner_user_id, discovery_run_id,
        created_at, updated_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       ON CONFLICT (dataset_id, normalized_name) 
       DO UPDATE SET
         name = EXCLUDED.name,
         normalized_name = EXCLUDED.normalized_name, -- CRITICAL: Update normalized_name on conflict
         address = EXCLUDED.address,
         postal_code = EXCLUDED.postal_code,
         city_id = EXCLUDED.city_id, -- CRITICAL: Update city_id on conflict (must not be NULL)
         industry_id = EXCLUDED.industry_id, -- CRITICAL: Update industry_id on conflict (must not be NULL)
         dataset_id = EXCLUDED.dataset_id, -- CRITICAL: Update dataset_id on conflict (must not be NULL)
         google_place_id = COALESCE(EXCLUDED.google_place_id, businesses.google_place_id),
         -- CRITICAL: Always set discovery_run_id if provided (EXCLUDED.discovery_run_id is not null)
         -- If EXCLUDED.discovery_run_id is NULL, keep existing value (for non-discovery updates)
         discovery_run_id = COALESCE(EXCLUDED.discovery_run_id, businesses.discovery_run_id),
         updated_at = NOW()
       RETURNING *`,
      insertValues
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
  } catch (error: any) {
    // CRITICAL: Catch NOT NULL violations and log exact values that caused failure
    if (error.code === '23502') { // NOT NULL violation
      console.error('[upsertBusiness] ===== NOT NULL VIOLATION =====');
      console.error('[upsertBusiness] Error code:', error.code);
      console.error('[upsertBusiness] Error message:', error.message);
      console.error('[upsertBusiness] Error detail:', error.detail);
      console.error('[upsertBusiness] Error constraint:', error.constraint);
      console.error('[upsertBusiness] Failed INSERT VALUES:', insertValues);
      console.error('[upsertBusiness] ===============================');
    }
    throw error;
  }
}

/**
 * Legacy createBusiness function - now uses upsertBusiness internally
 * Maintained for backward compatibility
 * 
 * NOTE: industry_id is now required (NOT NULL in database)
 */
export async function createBusiness(data: {
  name: string;
  address: string | null;
  postal_code: string | null;
  city_id: string; // UUID - REQUIRED (NOT NULL)
  industry_id: string; // UUID - REQUIRED (NOT NULL)
  google_place_id: string | null;
  dataset_id: string; // UUID - REQUIRED (NOT NULL)
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
    // Normalize and validate name (never empty)
    // This is computed BEFORE update to ensure consistency
    const normalized_name = normalizeBusinessName(data.name);
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

/**
 * Check if a business already has complete data (website + contacts)
 * Used to skip extraction for businesses we already have full information for
 * 
 * @param googlePlaceId - Google Place ID to check
 * @returns true if business exists with website and at least one contact, false otherwise
 */
export async function hasCompleteBusinessData(googlePlaceId: string): Promise<boolean> {
  const result = await pool.query<{ has_complete_data: boolean }>(
    `SELECT EXISTS(
      SELECT 1
      FROM businesses b
      WHERE b.google_place_id = $1
        AND EXISTS (SELECT 1 FROM websites w WHERE w.business_id = b.id)
        AND EXISTS (
          SELECT 1 
          FROM contact_sources cs
          JOIN contacts c ON c.id = cs.contact_id
          WHERE cs.business_id = b.id::text
            AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
        )
    ) as has_complete_data`,
    [googlePlaceId]
  );

  return result.rows[0]?.has_complete_data || false;
}

/**
 * Get map of Google Place IDs that already have complete data
 * Used to filter out businesses that don't need extraction
 * 
 * @param googlePlaceIds - Array of Google Place IDs to check
 * @returns Set of Google Place IDs that have complete data
 */
export async function getBusinessesWithCompleteData(
  googlePlaceIds: string[]
): Promise<Set<string>> {
  if (googlePlaceIds.length === 0) {
    return new Set();
  }

  const result = await pool.query<{ google_place_id: string }>(
    `SELECT DISTINCT b.google_place_id::text as google_place_id
     FROM businesses b
     WHERE b.google_place_id::text = ANY($1::text[])
       AND EXISTS (SELECT 1 FROM websites w WHERE w.business_id = b.id)
       AND EXISTS (
         SELECT 1 
         FROM contact_sources cs
         JOIN contacts c ON c.id = cs.contact_id
         WHERE cs.business_id = b.id::text
           AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
       )`,
    [googlePlaceIds]
  );

  return new Set(result.rows.map(row => row.google_place_id));
}