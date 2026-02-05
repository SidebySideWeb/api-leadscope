import { pool } from '../config/database.js';

export type ExtractionJobStatus = 'pending' | 'running' | 'success' | 'failed';

export interface ExtractionJob {
  id: string; // UUID
  business_id: number;
  // NOTE: extraction_jobs does NOT have discovery_run_id column
  // Use businesses.discovery_run_id to link extraction_jobs to discovery_runs
  status: ExtractionJobStatus;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

/**
 * Create a new extraction job
 * NOTE: extraction_jobs does NOT have discovery_run_id column
 * Use businesses.discovery_run_id to link extraction_jobs to discovery_runs
 */
export async function createExtractionJob(
  businessId: number
): Promise<ExtractionJob> {
  const result = await pool.query<ExtractionJob>(
    `INSERT INTO extraction_jobs (business_id, status)
     VALUES ($1, 'pending')
     ON CONFLICT (business_id) DO NOTHING
     RETURNING *`,
    [businessId]
  );

  if (result.rows.length === 0) {
    // Job already exists, fetch it
    const existing = await pool.query<ExtractionJob>(
      'SELECT * FROM extraction_jobs WHERE business_id = $1',
      [businessId]
    );
    return existing.rows[0];
  }

  return result.rows[0];
}

export async function getQueuedExtractionJobs(
  limit: number
): Promise<ExtractionJob[]> {
  const result = await pool.query<ExtractionJob>(
    `SELECT *
     FROM extraction_jobs
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );

  return result.rows;
}

export async function updateExtractionJob(
  id: string,
  data: {
    status?: ExtractionJobStatus;
    error_message?: string | null;
    started_at?: Date | null;
    completed_at?: Date | null;
  }
): Promise<ExtractionJob> {
  const updates: string[] = [];
  const values: any[] = [];
  let index = 1;

  if (data.status !== undefined) {
    updates.push(`status = $${index++}`);
    values.push(data.status);
  }
  if (data.error_message !== undefined) {
    updates.push(`error_message = $${index++}`);
    values.push(data.error_message);
  }
  if (data.started_at !== undefined) {
    updates.push(`started_at = $${index++}`);
    values.push(data.started_at);
  }
  if (data.completed_at !== undefined) {
    updates.push(`completed_at = $${index++}`);
    values.push(data.completed_at);
  }

  if (updates.length === 0) {
    const result = await pool.query<ExtractionJob>(
      'SELECT * FROM extraction_jobs WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  values.push(id);

  const result = await pool.query<ExtractionJob>(
    `UPDATE extraction_jobs
     SET ${updates.join(', ')}
     WHERE id = $${index}
     RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * Get extraction jobs by discovery_run_id
 * NOTE: extraction_jobs does NOT have discovery_run_id - query through businesses table
 */
export async function getExtractionJobsByDiscoveryRunId(
  discoveryRunId: string
): Promise<ExtractionJob[]> {
  const result = await pool.query<ExtractionJob>(
    `SELECT ej.* FROM extraction_jobs ej
     JOIN businesses b ON b.id = ej.business_id
     WHERE b.discovery_run_id = $1::uuid
     ORDER BY ej.created_at ASC`,
    [discoveryRunId]
  );

  return result.rows;
}
