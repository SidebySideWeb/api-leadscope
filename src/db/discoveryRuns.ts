import { pool } from '../config/database.js';

export type DiscoveryRunStatus = 'running' | 'completed' | 'failed';

export interface DiscoveryRun {
  id: string; // UUID
  dataset_id: string; // UUID
  user_id?: string; // UUID (optional, may not be in schema)
  industry_group_id?: string | null; // UUID (optional, for industry group discovery)
  status: DiscoveryRunStatus;
  created_at: Date;
  started_at: Date | null; // When execution actually began
  completed_at: Date | null;
  error_message: string | null;
  // Cost estimation data (stored as JSON, optional)
  cost_estimates?: {
    estimatedBusinesses: number;
    completenessStats: {
      withWebsitePercent: number;
      withEmailPercent: number;
      withPhonePercent: number;
    };
    exportEstimates: Array<{
      size: number;
      priceEUR: number;
    }>;
    refreshEstimates: {
      incompleteOnly: {
        pricePerBusinessEUR: number;
        estimatedTotalEUR: number;
      };
      fullRefresh: {
        pricePerBusinessEUR: number;
        estimatedTotalEUR: number;
      };
    };
  } | null;
}

/**
 * Create a new discovery run
 */
export async function createDiscoveryRun(
  datasetId: string,
  userId?: string,
  industryGroupId?: string | null
): Promise<DiscoveryRun> {
  // Try to insert with user_id and industry_group_id if provided
    // If columns don't exist in schema, fall back gracefully
    if (userId || industryGroupId) {
      try {
        const columns: string[] = ['dataset_id', 'status'];
        const values: any[] = [datasetId, 'running'];
        let paramIndex = 3;
        
        if (userId) {
          columns.push('user_id');
          values.push(userId);
          paramIndex++;
        }
        
        if (industryGroupId) {
          columns.push('industry_group_id');
          values.push(industryGroupId);
          paramIndex++;
        }
        
        const result = await pool.query<DiscoveryRun>(
          `INSERT INTO discovery_runs (${columns.join(', ')})
           VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
           RETURNING *`,
          values
        );
      const row = result.rows[0];
      return {
        ...row,
        cost_estimates: row.cost_estimates 
          ? (typeof row.cost_estimates === 'string' 
              ? JSON.parse(row.cost_estimates) 
              : row.cost_estimates)
          : null,
      };
      } catch (error: any) {
      // If user_id or industry_group_id column doesn't exist (PostgreSQL error code 42703), fall back
      if (error.code === '42703' || error.message?.includes('column')) {
        console.log('[createDiscoveryRun] Some columns not found, using dataset_id only');
        const result = await pool.query<DiscoveryRun>(
          `INSERT INTO discovery_runs (dataset_id, status)
           VALUES ($1, 'running')
           RETURNING *`,
          [datasetId]
        );
        const row = result.rows[0];
        return {
          ...row,
          cost_estimates: row.cost_estimates 
            ? (typeof row.cost_estimates === 'string' 
                ? JSON.parse(row.cost_estimates) 
                : row.cost_estimates)
            : null,
        };
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
    const row = result.rows[0];
    return {
      ...row,
      cost_estimates: row.cost_estimates 
        ? (typeof row.cost_estimates === 'string' 
            ? JSON.parse(row.cost_estimates) 
            : row.cost_estimates)
        : null,
    };
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
    cost_estimates?: DiscoveryRun['cost_estimates'];
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
  if (data.cost_estimates !== undefined) {
    updates.push(`cost_estimates = $${index++}`);
    values.push(JSON.stringify(data.cost_estimates));
  }

  if (updates.length === 0) {
    const result = await pool.query<DiscoveryRun>(
      'SELECT * FROM discovery_runs WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  values.push(id);

  let result;
  try {
    result = await pool.query<DiscoveryRun>(
      `UPDATE discovery_runs
       SET ${updates.join(', ')}
       WHERE id = $${index}
       RETURNING *`,
      values
    );
  } catch (error: any) {
    // If cost_estimates or error_message column doesn't exist, retry without them
    if (error.code === '42703' && (updates.some(u => u.includes('cost_estimates')) || updates.some(u => u.includes('error_message')))) {
      const missingColumns: string[] = [];
      if (updates.some(u => u.includes('cost_estimates'))) {
        missingColumns.push('cost_estimates');
        console.warn('[updateDiscoveryRun] cost_estimates column not found, retrying without it');
      }
      if (updates.some(u => u.includes('error_message'))) {
        missingColumns.push('error_message');
        console.warn('[updateDiscoveryRun] error_message column not found, retrying without it');
      }
      
      const filteredUpdates = updates.filter(u => !missingColumns.some(col => u.includes(col)));
      const filteredValues: any[] = [];
      let valueIndex = 0;
      for (let i = 0; i < updates.length; i++) {
        if (!missingColumns.some(col => updates[i].includes(col))) {
          filteredValues.push(values[i]);
        }
      }
      
      if (filteredUpdates.length > 0) {
        result = await pool.query<DiscoveryRun>(
          `UPDATE discovery_runs
           SET ${filteredUpdates.join(', ')}
           WHERE id = $${filteredValues.length + 1}
           RETURNING *`,
          [...filteredValues, id]
        );
      } else {
        // No updates to make, just fetch the row
        result = await pool.query<DiscoveryRun>(
          'SELECT * FROM discovery_runs WHERE id = $1',
          [id]
        );
      }
    } else {
      throw error;
    }
  }

  return result.rows[0];
}

/**
 * Get discovery runs by dataset_id
 */
export async function getDiscoveryRunsByDatasetId(
  datasetId: string
): Promise<DiscoveryRun[]> {
  const result = await pool.query<DiscoveryRun>(
    `SELECT id, status, created_at, started_at, completed_at, error_message, cost_estimates
     FROM discovery_runs
     WHERE dataset_id = $1
     ORDER BY created_at DESC`,
    [datasetId]
  );

  // Parse cost_estimates JSON if present
  return result.rows.map(row => ({
    ...row,
    cost_estimates: row.cost_estimates 
      ? (typeof row.cost_estimates === 'string' 
          ? JSON.parse(row.cost_estimates) 
          : row.cost_estimates)
      : null,
  }));
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

  if (!result.rows[0]) {
    return null;
  }

  // Parse cost_estimates JSON if present
  const row = result.rows[0];
  return {
    ...row,
    cost_estimates: row.cost_estimates 
      ? (typeof row.cost_estimates === 'string' 
          ? JSON.parse(row.cost_estimates) 
          : row.cost_estimates)
      : null,
  };
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
