/**
 * Store abstraction interface
 * Provides unified access to data storage with automatic fallback support
 */

import type { Dataset } from '../db/datasets.js';
import type { CrawlPageRecord } from '../db/crawlPages.js';
import type { Contact } from '../types/index.js';
import type { ExportRow } from '../types/exports.js';

export interface DatasetSnapshot {
  id: string;
  dataset_id: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
  data: {
    businesses: Array<{
      id: number;
      name: string;
      industry: string;
      city: string;
      website: string | null;
    }>;
    contacts: Array<{
      business_id: number;
      email: string | null;
      phone: string | null;
      mobile: string | null;
      source_url: string;
    }>;
  };
}

export interface CrawlJobInput {
  business_id: string; // UUID
  website_url: string;
  pages_limit?: number;
}

export interface CrawlJobRecord {
  id: string;
  business_id: string;
  website_url: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  pages_limit: number;
  pages_crawled: number;
  created_at: Date;
}

export interface Store {
  /**
   * Health check - returns true if store is available
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get the latest dataset for a user
   */
  getLatestDataset(userId: string): Promise<Dataset | null>;

  /**
   * Create a dataset snapshot (for caching)
   */
  createDatasetSnapshot(
    datasetId: string,
    userId: string,
    data: DatasetSnapshot['data']
  ): Promise<DatasetSnapshot>;

  /**
   * Get dataset snapshot if it exists and is still valid (<30 days old)
   */
  getDatasetSnapshot(
    datasetId: string,
    userId: string
  ): Promise<DatasetSnapshot | null>;

  /**
   * Create a crawl job
   */
  createCrawlJob(input: CrawlJobInput): Promise<CrawlJobRecord>;

  /**
   * Save a crawled page
   */
  savePage(
    crawlJobId: string,
    page: Omit<CrawlPageRecord, 'id' | 'crawl_job_id' | 'fetched_at'>
  ): Promise<CrawlPageRecord>;

  /**
   * Save extracted contacts
   */
  saveContacts(
    businessId: number,
    contacts: Array<{
      email?: string | null;
      phone?: string | null;
      mobile?: string | null;
      source_url: string;
      confidence?: number;
    }>
  ): Promise<Contact[]>;

  /**
   * Get export rows for a dataset with filters
   */
  getExportRows(filters: {
    datasetId: string;
    userId: string;
    rowLimit?: number;
  }): Promise<ExportRow[]>;
}
