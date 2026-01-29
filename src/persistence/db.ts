/**
 * Database persistence (Supabase/PostgreSQL)
 */

import { pool } from '../config/database.js';
import type { Persistence } from './index.js';
import type { BusinessWithWebsite, CrawlResultV1, DatasetCrawlSummary } from '../types/crawl.js';
import type { Business } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class DbPersistence implements Persistence {
  private availableCache: boolean | null = null;
  private availableCacheTime: number = 0;
  private readonly CACHE_MS = 60000; // 60 seconds

  async isAvailable(): Promise<boolean> {
    const now = Date.now();
    
    // Use cache if recent
    if (this.availableCache !== null && (now - this.availableCacheTime) < this.CACHE_MS) {
      return this.availableCache;
    }

    try {
      // Cheap query to check connection
      await pool.query('SELECT 1');
      this.availableCache = true;
      this.availableCacheTime = now;
      return true;
    } catch (error) {
      logger.debug('[DbPersistence] Database check failed:', error);
      this.availableCache = false;
      this.availableCacheTime = now;
      return false;
    }
  }

  async listBusinesses(datasetId: string, limit?: number): Promise<BusinessWithWebsite[]> {
    const query = limit
      ? `SELECT b.id, b.dataset_id, b.name, w.url as website_url
         FROM businesses b
         LEFT JOIN websites w ON w.business_id = b.id
         WHERE b.dataset_id = $1 AND w.url IS NOT NULL
         LIMIT $2`
      : `SELECT b.id, b.dataset_id, b.name, w.url as website_url
         FROM businesses b
         LEFT JOIN websites w ON w.business_id = b.id
         WHERE b.dataset_id = $1 AND w.url IS NOT NULL`;

    const params = limit ? [datasetId, limit] : [datasetId];
    const result = await pool.query<Business & { website_url: string | null }>(query, params);

    return result.rows.map(row => ({
      id: String(row.id), // Convert to UUID string
      dataset_id: row.dataset_id,
      name: row.name,
      website_url: row.website_url
    }));
  }

  async upsertCrawlResult(result: CrawlResultV1): Promise<void> {
    // SQL for crawl_results table (create separately as comment)
    /*
    CREATE TABLE IF NOT EXISTS crawl_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL,
      dataset_id UUID NOT NULL,
      website_url TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ NOT NULL,
      pages_visited INTEGER NOT NULL DEFAULT 0,
      crawl_status TEXT NOT NULL CHECK (crawl_status IN ('not_crawled', 'partial', 'completed')),
      emails JSONB NOT NULL DEFAULT '[]',
      phones JSONB NOT NULL DEFAULT '[]',
      contact_pages TEXT[] NOT NULL DEFAULT '[]',
      social JSONB NOT NULL DEFAULT '{}',
      errors JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(business_id, dataset_id)
    );

    CREATE INDEX IF NOT EXISTS idx_crawl_results_dataset ON crawl_results(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_crawl_results_business ON crawl_results(business_id);
    */

    await pool.query(
      `INSERT INTO crawl_results (
        business_id, dataset_id, website_url, started_at, finished_at,
        pages_visited, crawl_status, emails, phones, contact_pages, social, errors
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (business_id, dataset_id)
      DO UPDATE SET
        website_url = EXCLUDED.website_url,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        pages_visited = EXCLUDED.pages_visited,
        crawl_status = EXCLUDED.crawl_status,
        emails = EXCLUDED.emails,
        phones = EXCLUDED.phones,
        contact_pages = EXCLUDED.contact_pages,
        social = EXCLUDED.social,
        errors = EXCLUDED.errors,
        updated_at = NOW()`,
      [
        result.business_id,
        result.dataset_id,
        result.website_url,
        result.started_at,
        result.finished_at,
        result.pages_visited,
        result.crawl_status,
        JSON.stringify(result.emails),
        JSON.stringify(result.phones),
        result.contact_pages,
        JSON.stringify(result.social),
        JSON.stringify(result.errors)
      ]
    );
  }

  async saveSummary(_summary: DatasetCrawlSummary): Promise<void> {
    // Summary can be stored in a separate table or logged
    // For now, just log it
    logger.info('[DbPersistence] Summary saved (logged only)');
  }
}
