import { pool } from '../config/database.js';
import type { CrawlJob as LegacyCrawlJob } from '../types/index.js';
import type { JobType } from '../types/jobs.js';

// ---------------------------------------------------------------------------
// Legacy helpers (used by existing discovery/refresh flows)
// ---------------------------------------------------------------------------

export async function createCrawlJob(
  website_id: number,
  job_type: JobType = 'discovery',
  pages_limit: number = 25
): Promise<LegacyCrawlJob> {
  const result = await pool.query<LegacyCrawlJob>(
    `INSERT INTO crawl_jobs (website_id, status, pages_crawled, pages_limit, job_type, started_at, completed_at)
     VALUES ($1, 'pending', 0, $2, $3, NULL, NULL)
     RETURNING *`,
    [website_id, pages_limit, job_type]
  );
  return result.rows[0];
}

export async function updateCrawlJob(
  id: string,
  data: {
    status?: 'pending' | 'running' | 'completed' | 'failed';
    pages_crawled?: number;
    pages_limit?: number;
    error_message?: string | null;
    started_at?: Date | null;
    completed_at?: Date | null;
  }
): Promise<LegacyCrawlJob> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.status !== undefined) {
    updates.push(`status = $${paramCount++}`);
    values.push(data.status);
  }
  if (data.pages_crawled !== undefined) {
    updates.push(`pages_crawled = $${paramCount++}`);
    values.push(data.pages_crawled);
  }
  if (data.pages_limit !== undefined) {
    updates.push(`pages_limit = $${paramCount++}`);
    values.push(data.pages_limit);
  }
  if (data.error_message !== undefined) {
    updates.push(`error_message = $${paramCount++}`);
    values.push(data.error_message);
  }
  if (data.started_at !== undefined) {
    updates.push(`started_at = $${paramCount++}`);
    values.push(data.started_at);
  }
  if (data.completed_at !== undefined) {
    updates.push(`completed_at = $${paramCount++}`);
    values.push(data.completed_at);
  }

  if (updates.length === 0) {
    const result = await pool.query<LegacyCrawlJob>(
      'SELECT * FROM crawl_jobs WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  values.push(id);

  const result = await pool.query<LegacyCrawlJob>(
    `UPDATE crawl_jobs SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function getPendingCrawlJobs(
  limit: number = 10
): Promise<LegacyCrawlJob[]> {
  const result = await pool.query<LegacyCrawlJob>(
    `SELECT *
     FROM crawl_jobs 
     WHERE status = 'pending' 
     ORDER BY created_at ASC 
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// New crawl_jobs schema for single-process worker
// ---------------------------------------------------------------------------
export type CrawlJobStatus = 'queued' | 'running' | 'success' | 'failed';

export interface CrawlJobRecord {
  id: string; // uuid
  business_id: string; // uuid
  website_url: string;
  status: CrawlJobStatus;
  pages_limit: number;
  pages_crawled: number;
  attempts: number;
  started_at: Date | null;
  finished_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

export async function getQueuedCrawlJobs(
  limit: number
): Promise<CrawlJobRecord[]> {
  const result = await pool.query<CrawlJobRecord>(
    `SELECT *
     FROM crawl_jobs
     WHERE status = 'queued'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function markCrawlJobRunning(id: string): Promise<void> {
  await pool.query(
    `UPDATE crawl_jobs
     SET status = 'running',
         started_at = NOW(),
         last_error = NULL
     WHERE id = $1`,
    [id]
  );
}

export async function incrementPagesCrawled(
  id: string,
  pagesCrawled: number
): Promise<void> {
  await pool.query(
    `UPDATE crawl_jobs
     SET pages_crawled = $2
     WHERE id = $1`,
    [id, pagesCrawled]
  );
}

export async function markCrawlJobSuccess(
  id: string,
  pagesCrawled: number
): Promise<void> {
  await pool.query(
    `UPDATE crawl_jobs
     SET status = 'success',
         pages_crawled = $2,
         finished_at = NOW()
     WHERE id = $1`,
    [id, pagesCrawled]
  );
}

export async function markCrawlJobFailed(
  id: string,
  pagesCrawled: number,
  errorMessage: string
): Promise<void> {
  await pool.query(
    `UPDATE crawl_jobs
     SET status = 'failed',
         pages_crawled = $2,
         attempts = attempts + 1,
         last_error = $3,
         finished_at = NOW()
     WHERE id = $1`,
    [id, pagesCrawled, errorMessage]
  );
}
