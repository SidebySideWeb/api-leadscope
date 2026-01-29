import { pool } from '../config/database.js';

export type ExtractionJobStatus = 'queued' | 'running' | 'success' | 'failed';

export interface ExtractionJob {
  id: string; // UUID
  business_id: number;
  status: ExtractionJobStatus;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export async function getQueuedExtractionJobs(
  limit: number
): Promise<ExtractionJob[]> {
  const result = await pool.query<ExtractionJob>(
    `SELECT *
     FROM extraction_jobs
     WHERE status = 'queued'
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

