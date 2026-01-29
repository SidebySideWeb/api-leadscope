import { pool } from '../config/database.js';

export interface Dataset {
  id: string; // UUID
  user_id: string;
  name: string;
  city_id: number | null;
  industry_id: number | null;
  last_refreshed_at: Date | null;
  created_at: Date;
}

/**
 * Get dataset by ID
 * Verifies dataset exists and returns it
 */
export async function getDatasetById(datasetId: string): Promise<Dataset | null> {
  const result = await pool.query<Dataset>(
    'SELECT * FROM datasets WHERE id = $1',
    [datasetId]
  );
  return result.rows[0] || null;
}

/**
 * Verify dataset belongs to user
 */
export async function verifyDatasetOwnership(
  datasetId: string,
  userId: string
): Promise<boolean> {
  const dataset = await getDatasetById(datasetId);
  return dataset !== null && dataset.user_id === userId;
}

/**
 * Find existing dataset by city and industry for reuse
 * Returns dataset if it exists and was refreshed within 30 days
 */
export async function findReusableDataset(
  userId: string,
  cityId: number,
  industryId: number
): Promise<Dataset | null> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const result = await pool.query<Dataset>(
    `
    SELECT * FROM datasets
    WHERE user_id = $1
      AND city_id = $2
      AND industry_id = $3
      AND last_refreshed_at IS NOT NULL
      AND last_refreshed_at >= $4
    ORDER BY last_refreshed_at DESC
    LIMIT 1
    `,
    [userId, cityId, industryId, thirtyDaysAgo]
  );

  return result.rows[0] || null;
}

/**
 * Get or create dataset with reuse logic
 * If dataset exists for city + industry and was refreshed < 30 days ago, reuse it
 * Otherwise create a new dataset
 */
export async function getOrCreateDataset(
  userId: string,
  cityId: number,
  industryId: number,
  datasetName?: string
): Promise<Dataset> {
  // Try to find reusable dataset
  const existing = await findReusableDataset(userId, cityId, industryId);
  
  if (existing) {
    console.log(`[getOrCreateDataset] Reusing existing dataset: ${existing.id} (refreshed ${existing.last_refreshed_at})`);
    return existing;
  }

  // Create new dataset
  const name = datasetName || `Dataset ${cityId}-${industryId}-${Date.now()}`;
  
  const result = await pool.query<Dataset>(
    `
    INSERT INTO datasets (user_id, name, city_id, industry_id, last_refreshed_at, created_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING *
    `,
    [userId, name, cityId, industryId]
  );

  const newDataset = result.rows[0];
  console.log(`[getOrCreateDataset] Created new dataset: ${newDataset.id}`);
  
  return newDataset;
}

/**
 * Update dataset's last_refreshed_at timestamp
 */
export async function updateDatasetRefreshTime(datasetId: string): Promise<void> {
  await pool.query(
    'UPDATE datasets SET last_refreshed_at = NOW() WHERE id = $1',
    [datasetId]
  );
}
