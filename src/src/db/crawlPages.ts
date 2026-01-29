import { pool } from '../config/database.js';

export interface CrawlPageRecord {
  id: string; // uuid
  crawl_job_id: string; // uuid
  url: string;
  final_url: string;
  status_code: number | null;
  content_type: string | null;
  html: string;
  hash: string;
  fetched_at: Date;
}

export async function createCrawlPage(data: {
  crawl_job_id: string;
  url: string;
  final_url: string;
  status_code: number | null;
  content_type: string | null;
  html: string;
  hash: string;
  fetched_at?: Date;
}): Promise<CrawlPageRecord> {
  const result = await pool.query<CrawlPageRecord>(
    `INSERT INTO crawl_pages (
      crawl_job_id,
      url,
      final_url,
      status_code,
      content_type,
      html,
      hash,
      fetched_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
    RETURNING *`,
    [
      data.crawl_job_id,
      data.url,
      data.final_url,
      data.status_code,
      data.content_type,
      data.html,
      data.hash,
      data.fetched_at ?? null
    ]
  );

  return result.rows[0];
}

// Helper used by extraction worker to load pages for a business
export async function getCrawlPagesForBusiness(
  businessId: number
): Promise<CrawlPageRecord[]> {
  const result = await pool.query<CrawlPageRecord>(
    `SELECT cp.*
     FROM crawl_pages cp
     JOIN crawl_jobs cj ON cp.crawl_job_id = cj.id
     WHERE cj.business_id = $1
     ORDER BY cp.fetched_at ASC`,
    [businessId]
  );

  return result.rows;
}
