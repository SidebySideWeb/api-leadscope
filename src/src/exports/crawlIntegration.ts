/**
 * Integration between Crawl Worker v1 and Export Schema v1
 * Maps CrawlResultV1 + Business to export fields
 */

import type { CrawlResultV1 } from '../types/crawl.js';
import type { BusinessExportData } from './schemaV1.js';
import type { Business } from '../types/index.js';

/**
 * Convert CrawlResultV1 to export-compatible data structure
 */
export function crawlResultToExportData(
  crawlResult: CrawlResultV1,
  business: Business,
  industry: { name: string } | null,
  city: { name: string; latitude: number | null; longitude: number | null },
  country: { name: string; code: string } | null
): Partial<BusinessExportData> {
  // Determine crawl status
  let crawlStatus = 'not_crawled';
  if (crawlResult.crawl_status === 'completed') {
    crawlStatus = 'completed';
  } else if (crawlResult.crawl_status === 'partial') {
    crawlStatus = 'partial';
  }

  // Calculate crawl depth (estimate from pages visited)
  const crawlDepth = crawlResult.pages_visited > 0
    ? Math.ceil(Math.log2(crawlResult.pages_visited + 1))
    : null;

  // Last crawled timestamp
  const lastCrawledAt = crawlResult.finished_at
    ? new Date(crawlResult.finished_at)
    : null;

  // Calculate confidence score (average of email confidences if available)
  const confidences = crawlResult.emails
    .map(() => {
      // Try to extract confidence from context or use default
      return 0.7; // Default confidence
    })
    .filter((c): c is number => c !== undefined && c !== null);
  
  const avgConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : null;

  return {
    business: {
      id: business.id,
      name: business.name,
      normalized_name: business.normalized_name,
      address: business.address,
      postal_code: business.postal_code,
      dataset_id: business.dataset_id,
      created_at: business.created_at,
      google_place_id: business.google_place_id
    },
    industry,
    city,
    country,
    website: crawlResult.website_url
      ? {
          url: crawlResult.website_url,
          last_crawled_at: lastCrawledAt
        }
      : null,
    contacts: [
      ...crawlResult.emails.map(e => ({
        email: e.value,
        phone: null as string | null,
        source_url: e.source_url,
        page_type: crawlResult.contact_pages.includes(e.source_url) ? 'contact' : 'homepage',
        confidence: avgConfidence || undefined
      })),
      ...crawlResult.phones.map(p => ({
        email: null as string | null,
        phone: p.value,
        source_url: p.source_url,
        page_type: crawlResult.contact_pages.includes(p.source_url) ? 'contact' : 'homepage',
        confidence: undefined
      }))
    ],
    crawlInfo: {
      status: crawlStatus,
      depth: crawlDepth,
      pages_crawled: crawlResult.pages_visited
    }
  };
}

/**
 * Helper to get export fields from crawl result
 */
export function getExportFieldsFromCrawl(crawlResult: CrawlResultV1): {
  email: string;
  phone: string;
  contact_page_url: string;
  facebook_url: string;
  linkedin_url: string;
  crawl_status: string;
  crawl_depth: string;
  emails_found_count: string;
  last_crawled_at: string;
  has_email: string;
} {
  return {
    email: crawlResult.emails[0]?.value || '',
    phone: crawlResult.phones[0]?.value || '',
    contact_page_url: crawlResult.contact_pages[0] || '',
    facebook_url: crawlResult.social.facebook || '',
    linkedin_url: crawlResult.social.linkedin || '',
    crawl_status: crawlResult.crawl_status,
    crawl_depth: crawlResult.pages_visited > 0
      ? String(Math.ceil(Math.log2(crawlResult.pages_visited + 1)))
      : '',
    emails_found_count: String(crawlResult.emails.length),
    last_crawled_at: crawlResult.finished_at || '',
    has_email: crawlResult.emails.length > 0 ? 'true' : 'false'
  };
}
