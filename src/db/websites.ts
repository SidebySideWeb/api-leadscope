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
  try {
    console.log(`[createWebsite] Attempting to create website:`, {
      business_id: data.business_id,
      url: data.url.substring(0, 50) + '...'
    });

    const result = await pool.query<Website>(
      'INSERT INTO websites (business_id, url) VALUES ($1, $2) RETURNING *',
      [data.business_id, data.url]
    );

    if (result.rows.length === 0) {
      throw new Error('INSERT returned no rows');
    }

    console.log(`[createWebsite] Successfully created website with id: ${result.rows[0].id}`);
    return result.rows[0];
  } catch (error: any) {
    const errorDetails = {
      code: error.code,
      message: error.message,
      detail: error.detail,
      hint: error.hint,
      constraint: error.constraint,
      table: error.table,
      schema: error.schema,
      severity: error.severity,
      sqlState: error.sqlState,
      query: error.query,
      parameters: [data.business_id, data.url.substring(0, 50)]
    };

    if (error.code === '42501') {
      console.error(`[createWebsite] RLS POLICY VIOLATION - Permission denied:`, errorDetails);
      console.error(`[createWebsite] This indicates a Row Level Security policy is blocking the INSERT`);
      console.error(`[createWebsite] Check RLS policies on 'websites' table for INSERT operations`);
      if (data.business_id) {
        console.error(`[createWebsite] Verify that business_id ${data.business_id} exists and is accessible`);
      }
    } else if (error.code === '23503') {
      console.error(`[createWebsite] FOREIGN KEY VIOLATION:`, errorDetails);
      if (data.business_id) {
        console.error(`[createWebsite] Business with id ${data.business_id} may not exist`);
      }
    } else if (error.code === '23505') {
      console.error(`[createWebsite] UNIQUE CONSTRAINT VIOLATION:`, errorDetails);
    } else if (error.code === '42P01') {
      console.error(`[createWebsite] TABLE DOES NOT EXIST:`, errorDetails);
    } else if (error.code === '08006' || error.code === '57P01' || error.code === '57P02' || error.code === '57P03') {
      console.error(`[createWebsite] DATABASE CONNECTION ERROR:`, errorDetails);
    } else {
      console.error(`[createWebsite] DATABASE ERROR:`, errorDetails);
    }

    throw error;
  }
}

export async function updateWebsiteCrawlData(id: number, html_hash: string): Promise<Website> {
  const result = await pool.query<Website>(
    'UPDATE websites SET last_crawled_at = NOW(), html_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [html_hash, id]
  );
  return result.rows[0];
}

export async function getWebsiteById(id: number): Promise<Website | null> {
  const result = await pool.query<Website>(
    'SELECT * FROM websites WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
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
