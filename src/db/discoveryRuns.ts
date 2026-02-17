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
  // Check if industry_group_id column exists before trying to use it
  // This prevents errors when the migration hasn't been run yet
  let industryGroupIdColumnExists = false;
  if (industryGroupId) {
    try {
      // Use the pool that's already imported at the top of the file
      const columnCheck = await pool.query(
        `SELECT column_name 
         FROM information_schema.columns 
         WHERE table_schema = 'public'
         AND table_name = 'discovery_runs' 
         AND column_name = 'industry_group_id'`
      );
      industryGroupIdColumnExists = columnCheck.rows.length > 0;
      console.log(`[createDiscoveryRun] industry_group_id column exists check: ${industryGroupIdColumnExists} (for industryGroupId: ${industryGroupId})`);
      if (!industryGroupIdColumnExists) {
        console.log('[createDiscoveryRun] industry_group_id column does not exist, will skip it in INSERT');
      }
    } catch (checkError: any) {
      console.warn('[createDiscoveryRun] Could not check for industry_group_id column:', checkError?.message || checkError);
      console.warn('[createDiscoveryRun] Assuming column does not exist to be safe');
      // If we can't check, assume it doesn't exist to be safe
      industryGroupIdColumnExists = false;
    }
  } else {
    console.log('[createDiscoveryRun] No industryGroupId provided, skipping column check');
  }

  // Try to insert with user_id and industry_group_id if provided
    // If columns don't exist in schema, fall back gracefully
    // ALWAYS try the insert, but only include industry_group_id if column exists
    // We need to try the insert if we have userId OR industryGroupId (even if column doesn't exist)
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
        
        // Only add industry_group_id if column exists (checked above)
        if (industryGroupId && industryGroupIdColumnExists) {
          console.log('[createDiscoveryRun] Adding industry_group_id to INSERT:', industryGroupId);
          columns.push('industry_group_id');
          values.push(industryGroupId);
          paramIndex++;
        } else if (industryGroupId) {
          console.log('[createDiscoveryRun] Skipping industry_group_id in INSERT (column does not exist):', industryGroupId);
        }
        
        // Only select columns that exist - don't use RETURNING * to avoid errors if column doesn't exist
        // Use explicit column list in RETURNING to avoid errors if industry_group_id doesn't exist yet
        // We'll add industry_group_id to the result manually if it was inserted
        const result = await pool.query<DiscoveryRun & { industry_group_id?: string | null }>(
          `INSERT INTO discovery_runs (${columns.join(', ')})
           VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
           RETURNING id, dataset_id, status, created_at, started_at, completed_at, cost_estimates`,
          values
        );
      const row = result.rows[0];
      return {
        ...row,
        industry_group_id: industryGroupId || null, // Add manually since we can't return it if column doesn't exist
        cost_estimates: row.cost_estimates 
          ? (typeof row.cost_estimates === 'string' 
              ? JSON.parse(row.cost_estimates) 
              : row.cost_estimates)
          : null,
      };
      } catch (error: any) {
      // If user_id or industry_group_id column doesn't exist (PostgreSQL error code 42703), fall back
      // Check for various error formats: code 42703, or message containing "column" or "industry_group_id" or "does not exist"
      const isColumnError = error.code === '42703' || 
                           error.message?.includes('column') || 
                           error.message?.includes('industry_group_id') ||
                           error.message?.includes('does not exist') ||
                           (error.detail && error.detail.includes('industry_group_id'));
      
      if (isColumnError) {
        console.log('[createDiscoveryRun] Some columns not found (industry_group_id or user_id), using dataset_id only');
        console.log('[createDiscoveryRun] Error details:', {
          message: error.message,
          code: error.code,
          detail: error.detail,
          stack: error.stack?.substring(0, 200)
        });
        // Fall through to retry without the problematic columns
        const result = await pool.query<DiscoveryRun>(
          `INSERT INTO discovery_runs (dataset_id, status)
           VALUES ($1, 'running')
           RETURNING id, dataset_id, status, created_at, started_at, completed_at, cost_estimates`,
          [datasetId]
        );
        const row = result.rows[0];
        return {
          ...row,
          industry_group_id: industryGroupId || null, // Add manually since column doesn't exist yet
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
    // No userId or industryGroupId provided, insert with dataset_id only
    const result = await pool.query<DiscoveryRun>(
      `INSERT INTO discovery_runs (dataset_id, status)
       VALUES ($1, 'running')
       RETURNING id, dataset_id, status, created_at, started_at, completed_at, error_message, cost_estimates`,
      [datasetId]
    );
    const row = result.rows[0];
    return {
      ...row,
      industry_group_id: industryGroupId || null, // Add manually since column doesn't exist yet
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
  if (data.cost_estimates !== undefined) {
    updates.push(`cost_estimates = $${index++}`);
    values.push(JSON.stringify(data.cost_estimates));
  }

  if (updates.length === 0) {
    const result = await pool.query<DiscoveryRun>(
      'SELECT id, dataset_id, status, created_at, started_at, completed_at, cost_estimates FROM discovery_runs WHERE id = $1',
      [id]
    );
    const row = result.rows[0];
    return {
      ...row,
      industry_group_id: null, // Add manually since column might not exist
    };
  }

  values.push(id);

  let result;
  try {
    result = await pool.query<DiscoveryRun & { industry_group_id?: string | null }>(
      `UPDATE discovery_runs
       SET ${updates.join(', ')}
       WHERE id = $${index}
       RETURNING id, dataset_id, status, created_at, started_at, completed_at, error_message, cost_estimates`,
      values
    );
  } catch (error: any) {
    // If cost_estimates or industry_group_id column doesn't exist, retry without them
    if (error.code === '42703' && (updates.some(u => u.includes('cost_estimates')) || error.message?.includes('industry_group_id'))) {
      const missingColumns: string[] = [];
      if (updates.some(u => u.includes('cost_estimates'))) {
        missingColumns.push('cost_estimates');
        console.warn('[updateDiscoveryRun] cost_estimates column not found, retrying without it');
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
        result = await pool.query<DiscoveryRun & { industry_group_id?: string | null }>(
          `UPDATE discovery_runs
           SET ${filteredUpdates.join(', ')}
           WHERE id = $${filteredValues.length + 1}
           RETURNING id, dataset_id, status, created_at, started_at, completed_at, cost_estimates`,
          [...filteredValues, id]
        );
      } else {
        // No updates to make, just fetch the row
        result = await pool.query<DiscoveryRun>(
          'SELECT id, dataset_id, status, created_at, started_at, completed_at, cost_estimates FROM discovery_runs WHERE id = $1',
          [id]
        );
      }
    } else {
      throw error;
    }
  }

  const row = result.rows[0];
  return {
    ...row,
    industry_group_id: (row as any).industry_group_id || null, // May not exist in query result
    cost_estimates: row.cost_estimates 
      ? (typeof row.cost_estimates === 'string' 
          ? JSON.parse(row.cost_estimates) 
          : row.cost_estimates)
      : null,
  };
}

/**
 * Get discovery runs by dataset_id
 */
export async function getDiscoveryRunsByDatasetId(
  datasetId: string
): Promise<DiscoveryRun[]> {
  const result = await pool.query<DiscoveryRun>(
    `SELECT id, dataset_id, status, created_at, started_at, completed_at, cost_estimates
     FROM discovery_runs
     WHERE dataset_id = $1
     ORDER BY created_at DESC`,
    [datasetId]
  );

  // Parse cost_estimates JSON if present and add industry_group_id (might be null if column doesn't exist)
  return result.rows.map(row => ({
    ...row,
    industry_group_id: (row as any).industry_group_id || null, // May not exist in query result
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

  // Parse cost_estimates JSON if present and add industry_group_id (might be null if column doesn't exist)
  const row = result.rows[0];
  return {
    ...row,
    industry_group_id: (row as any).industry_group_id || null, // May not exist in query result
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
