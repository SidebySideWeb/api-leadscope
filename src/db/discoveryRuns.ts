import { pool } from '../config/database.js';

export type DiscoveryRunStatus = 'running' | 'completed' | 'failed';

export interface DiscoveryRun {
  id: string; // UUID
  dataset_id: string; // UUID
  user_id?: string; // UUID (optional, may not be in schema)
  status: DiscoveryRunStatus;
  created_at: Date;
  started_at: Date | null; // When execution actually began
  completed_at: Date | null;
  error_message: string | null;
}

/**
 * Create a new discovery run
 */
export async function createDiscoveryRun(
  datasetId: string,
  userId?: string
): Promise<DiscoveryRun> {
  // Try to insert with user_id if provided
  // If user_id column doesn't exist in schema, fall back to dataset_id only
  if (userId) {
    try {
      const result = await pool.query<DiscoveryRun>(
        `INSERT INTO discovery_runs (dataset_id, user_id, status)
         VALUES ($1, $2, 'running')
         RETURNING *`,
        [datasetId, userId]
      );
      return result.rows[0];
    } catch (error: any) {
      // If user_id column doesn't exist (PostgreSQL error code 42703), fall back
      if (error.code === '42703' || error.message?.includes('column "user_id"')) {
        console.log('[createDiscoveryRun] user_id column not found, using dataset_id only');
        const result = await pool.query<DiscoveryRun>(
          `INSERT INTO discovery_runs (dataset_id, status)
           VALUES ($1, 'running')
           RETURNING *`,
          [datasetId]
        );
        return result.rows[0];
      }
      // Re-throw other errors
      throw error;
    }
  } else {
    // No userId provided, insert with dataset_id only
    const result = await pool.query<DiscoveryRun>(
      `INSERT INTO discovery_runs (dataset_id, status)
       VALUES ($1, 'running')
       RETURNING *`,
      [datasetId]
    );
    return result.rows[0];
  }
}

/**
 * Update discovery run status
 */
export async function updateDiscoveryRun(
  id: string,
  data: {
    status?: DiscoveryRunStatus;
    started_at?: Date | null;
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
  if (data.started_at !== undefined) {
    updates.push(`started_at = $${index++}`);
    values.push(data.started_at);
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
    `SELECT id, status, created_at, started_at, completed_at, error_message
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

/**
 * Cleanup stuck discovery runs (runs that have been running too long without completion)
 * This is a fail-safe to ensure discovery_runs never get stuck in 'running' state forever
 * 
 * @param timeoutSeconds - How many seconds a run can be running before being considered stuck (default: 300 = 5 minutes)
 * @returns Number of runs marked as failed
 */
export async function cleanupStuckDiscoveryRuns(timeoutSeconds: number = 300): Promise<number> {
  const timeoutThreshold = new Date();
  timeoutThreshold.setSeconds(timeoutThreshold.getSeconds() - timeoutSeconds);
  
  // Find runs that:
  // 1. Are still in 'running' status
  // 2. Have started_at set (execution began)
  // 3. Have been running longer than timeout threshold
  // 4. Have no pending extraction jobs
  const result = await pool.query<{ id: string }>(
    `UPDATE discovery_runs
     SET status = 'failed',
         completed_at = NOW(),
         error_message = 'Discovery run timed out: exceeded maximum execution time'
     WHERE status = 'running'
     AND started_at IS NOT NULL
     AND started_at < $1
     AND NOT EXISTS (
       SELECT 1
       FROM businesses b
       JOIN extraction_jobs ej ON ej.business_id = b.id
       WHERE b.discovery_run_id = discovery_runs.id
       AND ej.status IN ('queued', 'running')
     )
     RETURNING id`,
    [timeoutThreshold]
  );
  
  if (result.rows.length > 0) {
    console.log(`[cleanupStuckDiscoveryRuns] Marked ${result.rows.length} stuck discovery runs as failed`);
  }
  
  return result.rows.length;
}
