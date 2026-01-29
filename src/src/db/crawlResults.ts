import { pool } from '../config/database.js';

export interface CrawlResultRecord {
  id: number;
  crawl_job_id: string; // UUID
  url: string;
  html: string;
  html_hash: string;
  page_type: 'homepage' | 'contact' | 'about' | 'company' | 'footer';
  created_at: Date;
}

export async function createCrawlResult(data: {
  crawl_job_id: string; // UUID
  url: string;
  html: string;
  html_hash: string;
  page_type: 'homepage' | 'contact' | 'about' | 'company' | 'footer';
}): Promise<CrawlResultRecord> {
  const result = await pool.query<CrawlResultRecord>(
    `INSERT INTO crawl_results (crawl_job_id, url, html, html_hash, page_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.crawl_job_id, data.url, data.html, data.html_hash, data.page_type]
  );
  return result.rows[0];
}

export async function getCrawlResultsByJobId(crawl_job_id: string): Promise<CrawlResultRecord[]> {
  const result = await pool.query<CrawlResultRecord>(
    'SELECT * FROM crawl_results WHERE crawl_job_id = $1 ORDER BY created_at ASC',
    [crawl_job_id]
  );
  return result.rows;
}

export async function deleteCrawlResultsByJobId(crawl_job_id: string): Promise<void> {
  await pool.query('DELETE FROM crawl_results WHERE crawl_job_id = $1', [crawl_job_id]);
}
