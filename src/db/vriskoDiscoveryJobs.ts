/**
 * Database functions for vrisko discovery job queue
 * Enables concurrent processing, batching, and resumable jobs
 */

import { pool } from '../config/database.js';

export type VriskoDiscoveryJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface VriskoDiscoveryJob {
  id: string; // UUID
  city_id: string; // UUID
  industry_id: string; // UUID
  dataset_id: string; // UUID
  user_id?: string | null; // UUID
  discovery_run_id?: string | null; // UUID
  status: VriskoDiscoveryJobStatus;
  priority: number;
  total_keywords: number;
  completed_keywords: number;
  total_pages: number;
  completed_pages: number;
  businesses_found: number;
  businesses_created: number;
  businesses_updated: number;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  scheduled_at: Date | null;
  metadata: any; // JSONB
}

export interface CreateVriskoDiscoveryJobInput {
  city_id: string;
  industry_id: string;
  dataset_id: string;
  user_id?: string;
  discovery_run_id?: string;
  priority?: number;
  scheduled_at?: Date;
  metadata?: any;
}

/**
 * Create a new vrisko discovery job
 */
export async function createVriskoDiscoveryJob(
  input: CreateVriskoDiscoveryJobInput
): Promise<VriskoDiscoveryJob> {
  const result = await pool.query<VriskoDiscoveryJob>(
    `INSERT INTO vrisko_discovery_jobs (
      city_id, industry_id, dataset_id, user_id, discovery_run_id,
      priority, scheduled_at, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      input.city_id,
      input.industry_id,
      input.dataset_id,
      input.user_id || null,
      input.discovery_run_id || null,
      input.priority || 0,
      input.scheduled_at || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );

  return result.rows[0];
}

/**
 * Get pending jobs ready to process
 * Orders by priority (desc) then created_at (asc)
 * Respects scheduled_at for delayed execution
 */
export async function getPendingVriskoDiscoveryJobs(
  limit: number = 10
): Promise<VriskoDiscoveryJob[]> {
  const result = await pool.query<VriskoDiscoveryJob>(
    `SELECT *
     FROM vrisko_discovery_jobs
     WHERE status = 'pending'
       AND (scheduled_at IS NULL OR scheduled_at <= NOW())
     ORDER BY priority DESC, created_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`, // Prevents concurrent workers from picking same job
    [limit]
  );

  return result.rows;
}

/**
 * Mark job as running (claim it for processing)
 */
export async function claimVriskoDiscoveryJob(
  jobId: string
): Promise<VriskoDiscoveryJob | null> {
  const result = await pool.query<VriskoDiscoveryJob>(
    `UPDATE vrisko_discovery_jobs
     SET status = 'running',
         started_at = COALESCE(started_at, NOW())
     WHERE id = $1
       AND status = 'pending'
     RETURNING *`,
    [jobId]
  );

  return result.rows[0] || null;
}

/**
 * Update job progress
 */
export async function updateVriskoDiscoveryJobProgress(
  jobId: string,
  progress: {
    completed_keywords?: number;
    completed_pages?: number;
    businesses_found?: number;
    businesses_created?: number;
    businesses_updated?: number;
    total_keywords?: number;
    total_pages?: number;
  }
): Promise<VriskoDiscoveryJob> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (progress.completed_keywords !== undefined) {
    updates.push(`completed_keywords = $${paramIndex++}`);
    values.push(progress.completed_keywords);
  }
  if (progress.completed_pages !== undefined) {
    updates.push(`completed_pages = $${paramIndex++}`);
    values.push(progress.completed_pages);
  }
  if (progress.businesses_found !== undefined) {
    updates.push(`businesses_found = $${paramIndex++}`);
    values.push(progress.businesses_found);
  }
  if (progress.businesses_created !== undefined) {
    updates.push(`businesses_created = $${paramIndex++}`);
    values.push(progress.businesses_created);
  }
  if (progress.businesses_updated !== undefined) {
    updates.push(`businesses_updated = $${paramIndex++}`);
    values.push(progress.businesses_updated);
  }
  if (progress.total_keywords !== undefined) {
    updates.push(`total_keywords = $${paramIndex++}`);
    values.push(progress.total_keywords);
  }
  if (progress.total_pages !== undefined) {
    updates.push(`total_pages = $${paramIndex++}`);
    values.push(progress.total_pages);
  }

  if (updates.length === 0) {
    // No updates, just return current job
    const result = await pool.query<VriskoDiscoveryJob>(
      'SELECT * FROM vrisko_discovery_jobs WHERE id = $1',
      [jobId]
    );
    return result.rows[0];
  }

  values.push(jobId);

  const result = await pool.query<VriskoDiscoveryJob>(
    `UPDATE vrisko_discovery_jobs
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * Mark job as completed
 */
export async function completeVriskoDiscoveryJob(
  jobId: string,
  finalStats?: {
    businesses_found: number;
    businesses_created: number;
    businesses_updated: number;
  }
): Promise<VriskoDiscoveryJob> {
  const updates: any = {
    status: 'completed',
    completed_at: new Date(),
  };

  if (finalStats) {
    updates.businesses_found = finalStats.businesses_found;
    updates.businesses_created = finalStats.businesses_created;
    updates.businesses_updated = finalStats.businesses_updated;
  }

  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`${key} = $${paramIndex++}`);
      values.push(value);
    }
  }

  values.push(jobId);

  const result = await pool.query<VriskoDiscoveryJob>(
    `UPDATE vrisko_discovery_jobs
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * Mark job as failed
 */
export async function failVriskoDiscoveryJob(
  jobId: string,
  errorMessage: string,
  shouldRetry: boolean = true
): Promise<VriskoDiscoveryJob> {
  // Get current job to check retry count
  const currentJob = await pool.query<VriskoDiscoveryJob>(
    'SELECT * FROM vrisko_discovery_jobs WHERE id = $1',
    [jobId]
  );

  if (currentJob.rows.length === 0) {
    throw new Error(`Job ${jobId} not found`);
  }

  const job = currentJob.rows[0];
  const newRetryCount = job.retry_count + 1;
  const shouldRetryJob = shouldRetry && newRetryCount < job.max_retries;

  const result = await pool.query<VriskoDiscoveryJob>(
    `UPDATE vrisko_discovery_jobs
     SET status = $1,
         error_message = $2,
         retry_count = $3,
         completed_at = CASE WHEN $4 = false THEN NOW() ELSE NULL END
     WHERE id = $5
     RETURNING *`,
    [
      shouldRetryJob ? 'pending' : 'failed',
      errorMessage,
      newRetryCount,
      shouldRetryJob,
      jobId,
    ]
  );

  return result.rows[0];
}

/**
 * Cancel a job
 */
export async function cancelVriskoDiscoveryJob(jobId: string): Promise<VriskoDiscoveryJob> {
  const result = await pool.query<VriskoDiscoveryJob>(
    `UPDATE vrisko_discovery_jobs
     SET status = 'cancelled',
         completed_at = NOW()
     WHERE id = $1
       AND status IN ('pending', 'running')
     RETURNING *`,
    [jobId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Job ${jobId} not found or cannot be cancelled`);
  }

  return result.rows[0];
}

/**
 * Get job by ID
 */
export async function getVriskoDiscoveryJobById(jobId: string): Promise<VriskoDiscoveryJob | null> {
  const result = await pool.query<VriskoDiscoveryJob>(
    'SELECT * FROM vrisko_discovery_jobs WHERE id = $1',
    [jobId]
  );

  return result.rows[0] || null;
}

/**
 * Get jobs by status
 */
export async function getVriskoDiscoveryJobsByStatus(
  status: VriskoDiscoveryJobStatus,
  limit: number = 100
): Promise<VriskoDiscoveryJob[]> {
  const result = await pool.query<VriskoDiscoveryJob>(
    `SELECT *
     FROM vrisko_discovery_jobs
     WHERE status = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [status, limit]
  );

  return result.rows;
}

/**
 * Get job statistics
 */
export async function getVriskoDiscoveryJobStats(): Promise<{
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}> {
  const result = await pool.query<{
    status: string;
    count: string;
  }>(
    `SELECT status, COUNT(*) as count
     FROM vrisko_discovery_jobs
     GROUP BY status`
  );

  const stats = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    total: 0,
  };

  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    stats.total += count;
    if (row.status in stats) {
      (stats as any)[row.status] = count;
    }
  }

  return stats;
}
