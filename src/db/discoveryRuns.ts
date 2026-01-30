import { pool } from '../config/database.js';

export type DiscoveryRunStatus = 'running' | 'completed' | 'failed';

export interface DiscoveryRun {
  id: string; // UUID
  dataset_id: string; // UUID
  status: DiscoveryRunStatus;
  created_at: Date;
  completed_at: Date | null;
  error_message: string | null;
}

/**
 * Create a new discovery run
 */
export async function createDiscoveryRun(
  datasetId: string
): Promise<DiscoveryRun> {
  const result = await pool.query<DiscoveryRun>(
    `INSERT INTO discovery_runs (dataset_id, status)
     VALUES ($1, 'running')
     RETURNING *`,
    [datasetId]
  );

  return result.rows[0];
}

/**
 * Update discovery run status
 */
export async function updateDiscoveryRun(
  id: string,
  data: {
    status?: DiscoveryRunStatus;
    completed_at?: Date | null;
    error_message?: string | null;
  }
): Promise<DiscoveryRun> {
  const updates: string[] = [];
  const values: any[] = [];
  let index = 1;

  if (data.status !== undefined) {
    updates.push(`status = $${index++}`);
    values.push(data.status);
  }
  if (data.completed_at !== undefined) {
    updates.push(`completed_at = $${index++}`);
    values.push(data.completed_at);
  }
  if (data.error_message !== undefined) {
    updates.push(`error_message = $${index++}`);
    values.push(data.error_message);
  }

  if (updates.length === 0) {
    const result = await pool.query<DiscoveryRun>(
      'SELECT * FROM discovery_runs WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  values.push(id);

  const result = await pool.query<DiscoveryRun>(
    `UPDATE discovery_runs
     SET ${updates.join(', ')}
     WHERE id = $${index}
     RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * Get discovery runs by dataset_id
 */
export async function getDiscoveryRunsByDatasetId(
  datasetId: string
): Promise<DiscoveryRun[]> {
  const result = await pool.query<DiscoveryRun>(
    `SELECT id, status, created_at, completed_at
     FROM discovery_runs
     WHERE dataset_id = $1
     ORDER BY created_at DESC`,
    [datasetId]
  );

  return result.rows;
}

/**
 * Get discovery run by ID
 */
export async function getDiscoveryRunById(
  id: string
): Promise<DiscoveryRun | null> {
  const result = await pool.query<DiscoveryRun>(
    'SELECT * FROM discovery_runs WHERE id = $1',
    [id]
  );

  return result.rows[0] || null;
}
