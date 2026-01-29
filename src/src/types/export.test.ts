/**
 * Export Schema v1 - Type Tests
 * 
 * Internal type checks and examples for ExportRowV1
 */

import {
  type ExportRowV1,
  type ExportMetaV1,
  type ExportPayloadV1,
  type BusinessExportInput,
  mapBusinessAndCrawlResultToExportRow,
  isValidExportRowV1,
  assertExportRowV1,
} from './export.js';
import type { Business } from './index.js';
import type { CrawlResultV1 } from './crawl.js';

/**
 * Example: Business with crawl result
 */
function exampleWithCrawlResult() {
  const business: Business = {
    id: 123,
    name: 'Example Business',
    normalized_name: 'example business',
    address: '123 Main St',
    postal_code: '12345',
    city_id: 1,
    industry_id: 5,
    google_place_id: 'ChIJ...',
    dataset_id: '61a72ba7-54bf-4eee-8ac5-6f2c8aa4c1d2',
    owner_user_id: 'user-123',
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
  };

  const crawlResult: CrawlResultV1 = {
    business_id: '123',
    dataset_id: '61a72ba7-54bf-4eee-8ac5-6f2c8aa4c1d2',
    website_url: 'https://example.com',
    started_at: '2024-01-01T10:00:00Z',
    finished_at: '2024-01-01T10:05:00Z',
    pages_visited: 5,
    crawl_status: 'completed',
    emails: [
      { value: 'contact@example.com', source_url: 'https://example.com/contact' },
      { value: 'info@example.com', source_url: 'https://example.com' },
    ],
    phones: [
      { value: '+30 210 1234567', source_url: 'https://example.com/contact' },
    ],
    contact_pages: ['https://example.com/contact'],
    social: {
      facebook: 'https://facebook.com/example',
      linkedin: 'https://linkedin.com/company/example',
    },
    errors: [],
  };

  const input: BusinessExportInput = {
    business,
    industry: { name: 'Technology' },
    city: { name: 'Athens' },
    crawlResult,
  };

  const exportRow: ExportRowV1 = mapBusinessAndCrawlResultToExportRow(input);

  // Type check
  assertExportRowV1(exportRow);

  // Verify structure
  console.assert(exportRow.dataset_id === business.dataset_id);
  console.assert(exportRow.business_id === '123');
  console.assert(exportRow.business_name === 'Example Business');
  console.assert(exportRow.emails.length === 2);
  console.assert(exportRow.phones.length === 1);
  console.assert(exportRow.crawl_status === 'completed');
  console.assert(exportRow.pages_visited === 5);
  console.assert(exportRow.social.facebook === 'https://facebook.com/example');
}

/**
 * Example: Business without crawl result (not_crawled)
 */
function exampleWithoutCrawlResult() {
  const business: Business = {
    id: 456,
    name: 'Uncrawled Business',
    normalized_name: 'uncrawled business',
    address: '456 Oak Ave',
    postal_code: null,
    city_id: 2,
    industry_id: null,
    google_place_id: null,
    dataset_id: '61a72ba7-54bf-4eee-8ac5-6f2c8aa4c1d2',
    owner_user_id: 'user-123',
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
  };

  const input: BusinessExportInput = {
    business,
    industry: null,
    city: { name: 'Thessaloniki' },
    crawlResult: null, // No crawl result
  };

  const exportRow: ExportRowV1 = mapBusinessAndCrawlResultToExportRow(input);

  // Type check
  assertExportRowV1(exportRow);

  // Verify structure
  console.assert(exportRow.crawl_status === 'not_crawled');
  console.assert(exportRow.pages_visited === 0);
  console.assert(exportRow.emails.length === 0);
  console.assert(exportRow.phones.length === 0);
  console.assert(exportRow.last_crawled_at === null);
}

/**
 * Example: ExportPayloadV1 with metadata
 */
function exampleExportPayload() {
  const rows: ExportRowV1[] = [
    // ... rows from mapBusinessAndCrawlResultToExportRow()
  ];

  const meta: ExportMetaV1 = {
    plan_id: 'demo',
    gated: true,
    total_available: 100,
    total_returned: 50,
    watermark: 'Demo Export - Limited to 50 rows',
    gate_reason: 'Demo plan limited to 50 rows per export',
    upgrade_hint: 'Upgrade to Starter plan for up to 1,000 rows per export',
  };

  const payload: ExportPayloadV1 = {
    rows,
    meta,
  };

  // Verify all rows are valid
  rows.forEach(row => assertExportRowV1(row));
}

/**
 * Type guard test
 */
function testTypeGuard() {
  const validRow: ExportRowV1 = {
    dataset_id: '61a72ba7-54bf-4eee-8ac5-6f2c8aa4c1d2',
    business_id: '123',
    business_name: 'Test',
    business_address: null,
    city: 'Athens',
    industry: null,
    website_url: null,
    emails: [],
    phones: [],
    social: {},
    last_crawled_at: null,
    crawl_status: 'not_crawled',
    pages_visited: 0,
  };

  const invalidRow = {
    dataset_id: '61a72ba7-54bf-4eee-8ac5-6f2c8aa4c1d2',
    // Missing required fields
  };

  console.assert(isValidExportRowV1(validRow) === true);
  console.assert(isValidExportRowV1(invalidRow) === false);
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Running Export Schema v1 type tests...');
  exampleWithCrawlResult();
  exampleWithoutCrawlResult();
  exampleExportPayload();
  testTypeGuard();
  console.log('All type tests passed!');
}
