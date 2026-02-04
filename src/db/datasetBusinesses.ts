/**
 * Dataset-Business Junction Table Functions
 * 
 * This module handles the many-to-many relationship between datasets and businesses.
 * Datasets are views over businesses, not data owners.
 */

import { pool } from '../config/database.js';

export interface DatasetBusiness {
  id: string; // UUID
  dataset_id: string; // UUID
  business_id: number;
  manually_included: boolean;
  manually_excluded: boolean;
  review_status: 'pending' | 'approved' | 'rejected' | 'flagged';
  added_at: Date;
  added_by_user_id: string | null;
  notes: string | null;
}

/**
 * Add business to dataset
 */
export async function addBusinessToDataset(
  businessId: number,
  datasetId: string,
  userId?: string
): Promise<DatasetBusiness> {
  const result = await pool.query<DatasetBusiness>(
    `INSERT INTO dataset_businesses (dataset_id, business_id, added_by_user_id, manually_included)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (dataset_id, business_id) 
     DO UPDATE SET
       manually_excluded = false,
       review_status = 'pending'
     RETURNING *`,
    [datasetId, businessId, userId || null]
  );

  if (result.rows.length === 0) {
    throw new Error(`Failed to add business ${businessId} to dataset ${datasetId}`);
  }

  return result.rows[0];
}

/**
 * Remove business from dataset (soft exclude)
 */
export async function removeBusinessFromDataset(
  businessId: number,
  datasetId: string
): Promise<void> {
  await pool.query(
    `UPDATE dataset_businesses
     SET manually_excluded = true,
         review_status = 'rejected'
     WHERE dataset_id = $1 AND business_id = $2`,
    [datasetId, businessId]
  );
}

/**
 * Get businesses in a dataset (excluding manually excluded)
 */
export async function getBusinessesInDataset(
  datasetId: string,
  includeExcluded: boolean = false
): Promise<number[]> {
  const query = includeExcluded
    ? `SELECT business_id FROM dataset_businesses WHERE dataset_id = $1`
    : `SELECT business_id FROM dataset_businesses WHERE dataset_id = $1 AND manually_excluded = false`;
  
  const result = await pool.query<{ business_id: number }>(query, [datasetId]);
  return result.rows.map(row => row.business_id);
}

/**
 * Check if business is in dataset
 */
export async function isBusinessInDataset(
  businessId: number,
  datasetId: string
): Promise<boolean> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM dataset_businesses
     WHERE dataset_id = $1 AND business_id = $2 AND manually_excluded = false`,
    [datasetId, businessId]
  );

  return parseInt(result.rows[0]?.count || '0', 10) > 0;
}
