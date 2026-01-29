/**
 * Export helpers for aggregating business data
 * No DB access - uses store abstraction
 */

import type { Store } from '../stores/store.js';
import type { BusinessExportData } from './schemaV1.js';
import type { Business } from '../types/index.js';

/**
 * Aggregate business data for export
 * NOTE: This is a placeholder function. In production, you would:
 * 1. Fetch industry, city, country from their respective tables via store
 * 2. Fetch website data from websites table via store
 * 3. Fetch contacts from contacts and contact_sources tables via store
 * 4. Fetch crawl info from crawl_jobs table via store
 * 
 * This function is provided as a template - implement based on your store's capabilities
 */
export async function aggregateBusinessData(
  _store: Store,
  businesses: Business[],
  _datasetId: string
): Promise<BusinessExportData[]> {
  console.log(`[aggregateBusinessData] Aggregating data for ${businesses.length} businesses`);
  console.warn('[aggregateBusinessData] This is a placeholder - implement based on your store');

  const aggregated: BusinessExportData[] = [];

  for (const business of businesses) {
    try {
      // Placeholder: Build minimal structure
      // In production, fetch related data from store
      const data: BusinessExportData = {
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
        industry: null, // Would be fetched from store
        city: {
          name: '', // Would be fetched from store
          latitude: null,
          longitude: null
        },
        country: null, // Would be fetched from store
        website: null, // Would be fetched from store
        contacts: [], // Would be fetched from store
        crawlInfo: null // Would be fetched from store
      };

      aggregated.push(data);
    } catch (error) {
      console.error(`[aggregateBusinessData] Error aggregating business ${business.id}:`, error);
      // Continue with next business
    }
  }

  console.log(`[aggregateBusinessData] Aggregated ${aggregated.length} businesses`);
  return aggregated;
}

/**
 * Create a simple business export data structure
 * Useful for testing or when data is already aggregated
 */
export function createBusinessExportData(
  business: Business,
  industry: { name: string } | null,
  city: { name: string; latitude: number | null; longitude: number | null },
  country: { name: string; code: string } | null,
  website: { url: string; last_crawled_at: Date | null } | null,
  contacts: Array<{
    email: string | null;
    phone: string | null;
    source_url: string;
    page_type: string;
    confidence?: number;
  }>,
  crawlInfo: {
    status: string;
    depth: number | null;
    pages_crawled: number | null;
  } | null
): BusinessExportData {
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
    website,
    contacts,
    crawlInfo
  };
}
