import { pool } from '../config/database.js';
import type { Website } from '../types/index.js';

export async function getWebsiteByUrl(url: string): Promise<Website | null> {
  const result = await pool.query<Website>(
    'SELECT * FROM websites WHERE url = $1',
    [url]
  );
  return result.rows[0] || null;
}

export async function createWebsite(data: {
  business_id: number | null;
  url: string;
}): Promise<Website> {
  const result = await pool.query<Website>(
    'INSERT INTO websites (business_id, url) VALUES ($1, $2) RETURNING *',
    [data.business_id, data.url]
  );
  return result.rows[0];
}

export async function updateWebsiteCrawlData(id: number, html_hash: string): Promise<Website> {
  const result = await pool.query<Website>(
    'UPDATE websites SET last_crawled_at = NOW(), html_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [html_hash, id]
  );
  return result.rows[0];
}

export async function getOrCreateWebsite(business_id: number | null, url: string): Promise<Website> {
  const existing = await getWebsiteByUrl(url);
  if (existing) {
    // Update business_id if it was null
    if (!existing.business_id && business_id) {
      const result = await pool.query<Website>(
        'UPDATE websites SET business_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [business_id, existing.id]
      );
      return result.rows[0];
    }
    return existing;
  }
  return createWebsite({ business_id, url });
}
