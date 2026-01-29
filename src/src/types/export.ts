/**
 * Export Schema v1 - Canonical Types
 * 
 * Single source of truth for export row structure used by:
 * - Dashboard tables/lists (businesses + contacts)
 * - Export worker (CSV/XLSX)
 * - API responses
 */

import type { PlanId } from './plan.js';
import type { Business } from './index.js';
import type { CrawlResultV1, CrawlStatus } from './crawl.js';

/**
 * Export Row v1 - Canonical structure for all export outputs
 * 
 * This is the single source of truth for export row structure.
 * All export formats (CSV, XLSX, JSON) use this structure.
 */
export interface ExportRowV1 {
  // Identifiers
  dataset_id: string; // UUID
  business_id: string; // UUID (or number, depending on DB schema)
  
  // Business information
  business_name: string;
  business_address: string | null;
  city: string;
  industry: string | null;
  
  // Website
  website_url: string | null;
  
  // Contact information (arrays for multiple values)
  emails: string[]; // Array of email addresses found
  phones: string[]; // Array of phone numbers found
  
  // Social links (optional fields)
  social: {
    facebook?: string | null;
    instagram?: string | null;
    linkedin?: string | null;
    tiktok?: string | null;
    youtube?: string | null;
    x?: string | null; // Twitter/X
    website?: string | null; // Additional website URL
  };
  
  // Source pages (where contacts were found)
  source_pages?: Array<{
    url: string;
    page_type: 'homepage' | 'contact' | 'about' | 'company' | 'footer';
    found_at: string; // ISO 8601 date string
  }>;
  
  // Crawl information
  last_crawled_at: string | null; // ISO 8601 date string or null
  crawl_status: CrawlStatus; // 'not_crawled' | 'partial' | 'completed'
  pages_visited: number; // Number of pages crawled
}

/**
 * Export Metadata v1 - Response metadata for export operations
 * 
 * Used in API responses to indicate plan limits, gating, and totals.
 */
export interface ExportMetaV1 {
  plan_id: PlanId; // 'demo' | 'starter' | 'pro'
  gated: boolean; // Whether export was limited by plan
  total_available: number; // Total rows available (before limits)
  total_returned: number; // Rows actually returned (after limits)
  watermark?: string; // Watermark text for gated exports
  gate_reason?: string; // Reason for gating (if gated)
  upgrade_hint?: string; // Upgrade suggestion (if gated)
}

/**
 * Export Payload v1 - Complete export response structure
 * 
 * Used in API responses and export file metadata.
 */
export interface ExportPayloadV1 {
  rows: ExportRowV1[];
  meta: ExportMetaV1;
}

/**
 * Input data for mapping business + crawl result to export row
 * 
 * Used by mapBusinessAndCrawlResultToExportRow() function.
 */
export interface BusinessExportInput {
  business: Business;
  industry: { name: string } | null;
  city: { name: string } | null;
  crawlResult?: CrawlResultV1 | null; // Optional - handles not_crawled case
}

/**
 * Map Business + CrawlResultV1 to ExportRowV1
 * 
 * Tolerates missing crawl results (crawl_status = 'not_crawled').
 * 
 * @param input - Business data with optional crawl result
 * @returns ExportRowV1 ready for export
 */
export function mapBusinessAndCrawlResultToExportRow(
  input: BusinessExportInput
): ExportRowV1 {
  const { business, industry, city, crawlResult } = input;
  
  // Handle missing crawl result
  const crawlStatus: CrawlStatus = crawlResult?.crawl_status || 'not_crawled';
  const pagesVisited = crawlResult?.pages_visited || 0;
  const lastCrawledAt = crawlResult?.finished_at || null;
  
  // Extract emails from crawl result or empty array
  const emails = crawlResult?.emails.map(e => e.value) || [];
  
  // Extract phones from crawl result or empty array
  const phones = crawlResult?.phones.map(p => p.value) || [];
  
  // Extract social links from crawl result or empty object
  const social = crawlResult?.social || {};
  
  // Build source pages from crawl result
  const sourcePages = crawlResult
    ? [
        ...crawlResult.emails.map(e => ({
          url: e.source_url,
          page_type: crawlResult.contact_pages.includes(e.source_url)
            ? ('contact' as const)
            : ('homepage' as const),
          found_at: crawlResult.finished_at || new Date().toISOString(),
        })),
        ...crawlResult.phones.map(p => ({
          url: p.source_url,
          page_type: crawlResult.contact_pages.includes(p.source_url)
            ? ('contact' as const)
            : ('homepage' as const),
          found_at: crawlResult.finished_at || new Date().toISOString(),
        })),
      ]
    : [];
  
  // Deduplicate source pages by URL
  const uniqueSourcePages = Array.from(
    new Map(sourcePages.map(page => [page.url, page])).values()
  );
  
  // Get website URL from crawl result or business (if available)
  const websiteUrl = crawlResult?.website_url || null;
  
  return {
    dataset_id: business.dataset_id,
    business_id: String(business.id), // Convert to string for consistency
    business_name: business.name,
    business_address: business.address,
    city: city?.name || '',
    industry: industry?.name || null,
    website_url: websiteUrl,
    emails,
    phones,
    social: {
      facebook: social.facebook || null,
      instagram: social.instagram || null,
      linkedin: social.linkedin || null,
      tiktok: undefined, // Not in CrawlResultV1, but allowed in ExportRowV1
      youtube: social.youtube || null,
      x: social.twitter || null, // Map twitter to x
      website: websiteUrl || null,
    },
    source_pages: uniqueSourcePages.length > 0 ? uniqueSourcePages : undefined,
    last_crawled_at: lastCrawledAt,
    crawl_status: crawlStatus,
    pages_visited: pagesVisited,
  };
}

/**
 * Type guard to validate ExportRowV1
 */
export function isValidExportRowV1(row: unknown): row is ExportRowV1 {
  if (typeof row !== 'object' || row === null) {
    return false;
  }
  
  const r = row as Record<string, unknown>;
  
  // Check required fields
  return (
    typeof r.dataset_id === 'string' &&
    typeof r.business_id === 'string' &&
    typeof r.business_name === 'string' &&
    typeof r.city === 'string' &&
    Array.isArray(r.emails) &&
    Array.isArray(r.phones) &&
    typeof r.crawl_status === 'string' &&
    typeof r.pages_visited === 'number'
  );
}

/**
 * Assert helper for type checking in tests
 */
export function assertExportRowV1(row: unknown): asserts row is ExportRowV1 {
  if (!isValidExportRowV1(row)) {
    throw new Error('Invalid ExportRowV1: missing required fields');
  }
}
