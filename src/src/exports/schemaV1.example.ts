/**
 * Example usage of Export Schema v1
 * Demonstrates how to use the export functions
 */

import { buildExportRows, exportToCSV, exportToJSON, type BusinessExportData } from './schemaV1.js';
import { createBusinessExportData } from './exportHelpers.js';
import type { Business } from '../types/index.js';

/**
 * Example: Export businesses to CSV
 */
export function exampleExportToCSV() {
  // Sample business data (already aggregated)
  const businesses: BusinessExportData[] = [
    createBusinessExportData(
      {
        id: 1,
        name: 'Example Business',
        normalized_name: 'example-business',
        address: '123 Main St',
        postal_code: '12345',
        city_id: 1,
        industry_id: 1,
        google_place_id: 'ChIJ...',
        dataset_id: 'dataset-123',
        owner_user_id: 'user-456',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01')
      } as Business,
      { name: 'Technology' },
      { name: 'Athens', latitude: 37.9838, longitude: 23.7275 },
      { name: 'Greece', code: 'GR' },
      { url: 'https://example.com', last_crawled_at: new Date('2024-01-15') },
      [
        {
          email: 'contact@example.com',
          phone: null,
          source_url: 'https://example.com/contact',
          page_type: 'contact',
          confidence: 0.9
        }
      ],
      {
        status: 'completed',
        depth: 3,
        pages_crawled: 5
      }
    )
  ];

  // Build export rows (demo tier - max 50 rows)
  const rows = buildExportRows(businesses, 'demo');
  
  // Export to CSV
  const csv = exportToCSV(rows);
  console.log('CSV Export:');
  console.log(csv);

  return csv;
}

/**
 * Example: Export businesses to JSON
 */
export function exampleExportToJSON() {
  // Sample business data
  const businesses: BusinessExportData[] = [
    createBusinessExportData(
      {
        id: 1,
        name: 'Example Business',
        normalized_name: 'example-business',
        address: '123 Main St',
        postal_code: '12345',
        city_id: 1,
        industry_id: 1,
        google_place_id: 'ChIJ...',
        dataset_id: 'dataset-123',
        owner_user_id: 'user-456',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01')
      } as Business,
      { name: 'Technology' },
      { name: 'Athens', latitude: 37.9838, longitude: 23.7275 },
      { name: 'Greece', code: 'GR' },
      { url: 'https://example.com', last_crawled_at: new Date('2024-01-15') },
      [
        {
          email: 'contact@example.com',
          phone: '+30 1234567890',
          source_url: 'https://example.com/contact',
          page_type: 'contact',
          confidence: 0.9
        }
      ],
      {
        status: 'completed',
        depth: 3,
        pages_crawled: 5
      }
    )
  ];

  // Build export rows (paid tier - unlimited)
  const rows = buildExportRows(businesses, 'paid');
  
  // Export to JSON
  const json = exportToJSON(rows);
  console.log('JSON Export:');
  console.log(json);

  return json;
}

/**
 * Example: Demo tier enforcement (max 50 rows)
 */
export function exampleDemoTierEnforcement() {
  // Create 100 businesses
  const businesses: BusinessExportData[] = Array.from({ length: 100 }, (_, i) =>
    createBusinessExportData(
      {
        id: i + 1,
        name: `Business ${i + 1}`,
        normalized_name: `business-${i + 1}`,
        address: null,
        postal_code: null,
        city_id: 1,
        industry_id: 1,
        google_place_id: null,
        dataset_id: 'dataset-123',
        owner_user_id: 'user-456',
        created_at: new Date(),
        updated_at: new Date()
      } as Business,
      { name: 'Technology' },
      { name: 'Athens', latitude: null, longitude: null },
      { name: 'Greece', code: 'GR' },
      null,
      [],
      null
    )
  );

  // Build export rows with demo tier
  const rows = buildExportRows(businesses, 'demo');
  
  console.log(`Total businesses: ${businesses.length}`);
  console.log(`Exported rows: ${rows.length}`);
  console.log(`Is truncated: ${rows[0]?.is_truncated}`);
  console.log(`Row numbers: ${rows[0]?.row_number} to ${rows[rows.length - 1]?.row_number}`);

  return rows;
}
