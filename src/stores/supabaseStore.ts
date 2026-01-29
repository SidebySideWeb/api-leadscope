/**
 * SupabaseStore - Real database implementation
 * Uses PostgreSQL via Supabase
 */

import { pool } from '../config/database.js';
import type { Store, DatasetSnapshot, CrawlJobInput, CrawlJobRecord } from './store.js';
import type { Dataset } from '../db/datasets.js';
import type { CrawlPageRecord } from '../db/crawlPages.js';
import type { Contact } from '../types/index.js';
import type { ExportRow } from '../types/exports.js';
import { createCrawlPage } from '../db/crawlPages.js';
import { getOrCreateContact } from '../db/contacts.js';
import { createContactSource } from '../db/contactSources.js';

export class SupabaseStore implements Store {
  async healthCheck(): Promise<boolean> {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async getLatestDataset(userId: string): Promise<Dataset | null> {
    const result = await pool.query<Dataset>(
      `SELECT * FROM datasets 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  async createDatasetSnapshot(
    datasetId: string,
    userId: string,
    data: DatasetSnapshot['data']
  ): Promise<DatasetSnapshot> {
    const snapshotId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    // Store snapshot in dataset_snapshots table (JSONB column)
    const result = await pool.query<{
      id: string;
      dataset_id: string;
      user_id: string;
      created_at: Date;
      expires_at: Date;
      snapshot_data: unknown;
    }>(
      `INSERT INTO dataset_snapshots (
        id, dataset_id, user_id, created_at, expires_at, snapshot_data
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING id, dataset_id, user_id, created_at, expires_at, snapshot_data`,
      [snapshotId, datasetId, userId, now, expiresAt, JSON.stringify(data)]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      dataset_id: row.dataset_id,
      user_id: row.user_id,
      created_at: row.created_at,
      expires_at: row.expires_at,
      data: row.snapshot_data as DatasetSnapshot['data']
    };
  }

  async getDatasetSnapshot(
    datasetId: string,
    userId: string
  ): Promise<DatasetSnapshot | null> {
    const result = await pool.query<{
      id: string;
      dataset_id: string;
      user_id: string;
      created_at: Date;
      expires_at: Date;
      snapshot_data: unknown;
    }>(
      `SELECT * FROM dataset_snapshots
       WHERE dataset_id = $1 
         AND user_id = $2 
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [datasetId, userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      dataset_id: row.dataset_id,
      user_id: row.user_id,
      created_at: row.created_at,
      expires_at: row.expires_at,
      data: row.snapshot_data as DatasetSnapshot['data']
    };
  }

  async createCrawlJob(input: CrawlJobInput): Promise<CrawlJobRecord> {
    const jobId = crypto.randomUUID();
    const result = await pool.query<CrawlJobRecord>(
      `INSERT INTO crawl_jobs (
        id, business_id, website_url, status, pages_limit, pages_crawled, created_at
      ) VALUES ($1, $2, $3, 'queued', $4, 0, NOW())
      RETURNING *`,
      [jobId, input.business_id, input.website_url, input.pages_limit || 15]
    );
    return result.rows[0];
  }

  async savePage(
    crawlJobId: string,
    page: Omit<CrawlPageRecord, 'id' | 'crawl_job_id' | 'fetched_at'>
  ): Promise<CrawlPageRecord> {
    return createCrawlPage({
      crawl_job_id: crawlJobId,
      ...page,
      fetched_at: new Date()
    });
  }

  async saveContacts(
    businessId: number,
    contacts: Array<{
      email?: string | null;
      phone?: string | null;
      mobile?: string | null;
      source_url: string;
      confidence?: number;
    }>
  ): Promise<Contact[]> {
    const saved: Contact[] = [];

    for (const contact of contacts) {
      try {
        const contactRecord = await getOrCreateContact({
          email: contact.email || null,
          phone: contact.phone || null,
          mobile: contact.mobile || null,
          contact_type: contact.email ? 'email' : 'phone',
          is_generic: false // Could be enhanced with confidence-based logic
        });

        await createContactSource({
          contact_id: contactRecord.id,
          source_url: contact.source_url,
          page_type: 'homepage', // Could be inferred from URL
          html_hash: '' // Would need to be passed in
        });

        saved.push(contactRecord);
      } catch (error) {
        console.error(`Error saving contact for business ${businessId}:`, error);
      }
    }

    return saved;
  }

  async getExportRows(filters: {
    datasetId: string;
    userId: string;
    rowLimit?: number;
  }): Promise<ExportRow[]> {
    let query = `
      SELECT DISTINCT
        b.name as company_name,
        i.name as industry,
        c.name as city,
        b.address,
        w.url as website,
        ct.email,
        ct.phone,
        ct.mobile,
        cs.source_url,
        ct.first_seen_at,
        ct.last_verified_at,
        CASE WHEN ct.is_active THEN 'active' ELSE 'removed' END as contact_status
      FROM businesses b
      JOIN industries i ON b.industry_id = i.id
      JOIN cities c ON b.city_id = c.id
      LEFT JOIN websites w ON w.business_id = b.id
      JOIN contact_sources cs ON cs.source_url LIKE '%' || REPLACE(REPLACE(w.url, 'https://', ''), 'http://', '') || '%'
         OR cs.source_url = w.url
      JOIN contacts ct ON ct.id = cs.contact_id
      WHERE b.dataset_id = $1 AND b.owner_user_id = $2
    `;

    const params: unknown[] = [filters.datasetId, filters.userId];

    if (filters.rowLimit) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(filters.rowLimit);
    }

    query += ` ORDER BY b.name, ct.last_verified_at DESC`;

    const result = await pool.query<ExportRow>(query, params);
    return result.rows;
  }
}
