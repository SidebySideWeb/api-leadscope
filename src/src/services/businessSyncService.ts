/**
 * Business Sync Service
 * 
 * Handles monthly sync/refresh of businesses from Google Places API.
 * Updates existing businesses with fresh data.
 */

import { pool } from '../config/database.js';
import { getBusinessesNeedingRefresh, upsertBusiness } from '../db/businesses.js';
import { getOrCreateCity } from '../db/cities.js';
import { getCountryByCode } from '../db/countries.js';
import { googleMapsService } from './googleMaps.js';
import { getOrCreateWebsite } from '../db/websites.js';
import { createCrawlJob } from '../db/crawlJobs.js';
import type { Business } from '../types/index.js';

const GREECE_COUNTRY_CODE = 'GR';

export interface BusinessSyncResult {
  businessesProcessed: number;
  businessesUpdated: number;
  businessesSkipped: number;
  errors: string[];
}

/**
 * Sync a single business by fetching fresh data from Google Places API
 */
async function syncBusiness(business: Business): Promise<{ updated: boolean; error?: string }> {
  try {
    // Skip if no google_place_id
    if (!business.google_place_id) {
      return { updated: false, error: 'No google_place_id' };
    }

    // Fetch fresh data from Google Places API
    const placeDetails = await googleMapsService.getPlaceDetails(business.google_place_id);
    
    if (!placeDetails) {
      return { updated: false, error: 'Place not found in Google Places' };
    }

    // Get country
    const country = await getCountryByCode(GREECE_COUNTRY_CODE);
    if (!country) {
      return { updated: false, error: 'Country GR not found' };
    }

    // Extract city and postal code
    let cityName: string | null = null;
    let postalCode: string | null = null;

    if (placeDetails.address_components) {
      for (const component of placeDetails.address_components) {
        if (component.types.includes('locality')) {
          cityName = component.long_name;
        } else if (!cityName && component.types.includes('administrative_area_level_2')) {
          cityName = component.long_name;
        }
        if (component.types.includes('postal_code')) {
          postalCode = component.short_name;
        }
      }
    }

    if (!cityName && placeDetails.formatted_address) {
      const addressParts = placeDetails.formatted_address.split(',');
      if (addressParts.length > 0) {
        cityName = addressParts[addressParts.length - 2]?.trim() || null;
      }
    }

    if (!cityName) {
      return { updated: false, error: 'Could not extract city from place data' };
    }

    // Get or create city
    const city = await getOrCreateCity(cityName, country.id);

    // Upsert business with fresh data
    const { wasUpdated } = await upsertBusiness({
      name: placeDetails.name || business.name,
      address: placeDetails.formatted_address || business.address,
      postal_code: postalCode || business.postal_code,
      city_id: city.id,
      industry_id: business.industry_id,
      google_place_id: business.google_place_id,
      dataset_id: business.dataset_id,
      owner_user_id: business.owner_user_id,
    });

    // Update website if provided
    if (placeDetails.website) {
      try {
        await getOrCreateWebsite(business.id, placeDetails.website);
        // Optionally create crawl job to refresh contacts
        // await createCrawlJob(website.id, 'refresh');
      } catch (error) {
        console.error(`Error updating website for business ${business.id}:`, error);
      }
    }

    return { updated: wasUpdated };
  } catch (error: any) {
    return { updated: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Sync businesses for a specific dataset
 */
export async function syncDatasetBusinesses(
  datasetId: string,
  limit?: number
): Promise<BusinessSyncResult> {
  const result: BusinessSyncResult = {
    businessesProcessed: 0,
    businessesUpdated: 0,
    businessesSkipped: 0,
    errors: [],
  };

  try {
    // Get businesses needing refresh for this dataset
    const businesses = await getBusinessesNeedingRefresh(datasetId);
    const businessesToSync = limit ? businesses.slice(0, limit) : businesses;

    console.log(`\n🔄 Syncing ${businessesToSync.length} businesses for dataset ${datasetId}`);

    for (const business of businessesToSync) {
      result.businessesProcessed++;

      const syncResult = await syncBusiness(business);

      if (syncResult.error) {
        result.errors.push(`Business ${business.id}: ${syncResult.error}`);
        result.businessesSkipped++;
      } else if (syncResult.updated) {
        result.businessesUpdated++;
      } else {
        result.businessesSkipped++;
      }

      // Rate limiting: small delay between API calls
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`\n✅ Sync completed:`);
    console.log(`   Processed: ${result.businessesProcessed}`);
    console.log(`   Updated: ${result.businessesUpdated}`);
    console.log(`   Skipped: ${result.businessesSkipped}`);
    if (result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.length}`);
    }

    return result;
  } catch (error: any) {
    result.errors.push(error.message || 'Sync failed');
    return result;
  }
}

/**
 * Sync all businesses across all datasets (monthly job)
 */
export async function syncAllBusinesses(limit?: number): Promise<BusinessSyncResult> {
  const result: BusinessSyncResult = {
    businessesProcessed: 0,
    businessesUpdated: 0,
    businessesSkipped: 0,
    errors: [],
  };

  try {
    // Get businesses needing refresh (across all datasets)
    const businesses = await getBusinessesNeedingRefresh();
    const businessesToSync = limit ? businesses.slice(0, limit) : businesses;

    console.log(`\n🔄 Monthly sync: Processing ${businessesToSync.length} businesses`);

    for (const business of businessesToSync) {
      result.businessesProcessed++;

      const syncResult = await syncBusiness(business);

      if (syncResult.error) {
        result.errors.push(`Business ${business.id}: ${syncResult.error}`);
        result.businessesSkipped++;
      } else if (syncResult.updated) {
        result.businessesUpdated++;
      } else {
        result.businessesSkipped++;
      }

      // Rate limiting: small delay between API calls
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`\n✅ Monthly sync completed:`);
    console.log(`   Processed: ${result.businessesProcessed}`);
    console.log(`   Updated: ${result.businessesUpdated}`);
    console.log(`   Skipped: ${result.businessesSkipped}`);
    if (result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.length}`);
    }

    return result;
  } catch (error: any) {
    result.errors.push(error.message || 'Monthly sync failed');
    return result;
  }
}
