/**
 * Crawl Worker v1 Types
 */

export type CrawlJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type CrawlStatus = 'not_crawled' | 'partial' | 'completed';

export interface CrawlResultV1 {
  business_id: string; // UUID
  dataset_id: string; // UUID
  website_url: string;
  started_at: string; // ISO 8601
  finished_at: string; // ISO 8601
  pages_visited: number;
  crawl_status: CrawlStatus;
  emails: Array<{
    value: string;
    source_url: string;
    context?: string;
  }>;
  phones: Array<{
    value: string;
    source_url: string;
  }>;
  contact_pages: string[];
  social: {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
    twitter?: string;
    youtube?: string;
  };
  errors: Array<{
    url: string;
    message: string;
  }>;
}

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  concurrency?: number;
  timeout?: number;
  delayMs?: number;
}

export interface BusinessWithWebsite {
  id: string; // UUID
  dataset_id: string; // UUID
  name: string;
  website_url: string | null;
}

export interface DatasetCrawlSummary {
  dataset_id: string;
  total_businesses: number;
  crawled: number;
  failed: number;
  skipped: number;
  total_pages: number;
  total_emails: number;
  total_phones: number;
  started_at: string;
  finished_at: string;
  errors: Array<{
    business_id: string;
    error: string;
  }>;
}
