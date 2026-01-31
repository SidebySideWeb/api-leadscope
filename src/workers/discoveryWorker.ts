import type { DiscoveryInput } from '../types/index.js';
import { googleMapsService } from '../services/googleMaps.js';
import { getCountryByCode } from '../db/countries.js';
import { getOrCreateIndustry, getIndustryById } from '../db/industries.js';
import { getOrCreateCity, getCityByNormalizedName, updateCityCoordinates, getCityById } from '../db/cities.js';
import { getBusinessByGooglePlaceId, upsertBusiness } from '../db/businesses.js';
import { getOrCreateWebsite } from '../db/websites.js';
import { createCrawlJob } from '../db/crawlJobs.js';
import { getDatasetById } from '../db/datasets.js';
import { createExtractionJob } from '../db/extractionJobs.js';
import type { GooglePlaceResult } from '../types/index.js';

const GREECE_COUNTRY_CODE = 'GR';

export interface DiscoveryResult {
  businessesFound: number;
  businessesCreated: number;
  businessesSkipped: number;
  businessesUpdated: number;
  websitesCreated: number;
  errors: string[];
}

/**
 * Extract domain from URL for deduplication
 */
function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Normalize business name for deduplication
 */
function normalizeBusinessName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Deduplicate places by priority:
 * 1. google_place_id (if available)
 * 2. website domain
 * Note: normalized name + city_id deduplication happens during upsert (database constraint)
 */
function deduplicatePlaces(places: GooglePlaceResult[]): GooglePlaceResult[] {
  const seenByPlaceId = new Map<string, GooglePlaceResult>();
  const seenByDomain = new Map<string, GooglePlaceResult>();
  const uniquePlaces: GooglePlaceResult[] = [];

  for (const place of places) {
    let isDuplicate = false;

    // Priority 1: google_place_id
    if (place.place_id) {
      if (seenByPlaceId.has(place.place_id)) {
        isDuplicate = true;
      } else {
        seenByPlaceId.set(place.place_id, place);
      }
    }

    // Priority 2: website domain (only if place_id didn't match)
    if (!isDuplicate && place.website) {
      const domain = extractDomain(place.website);
      if (domain) {
        if (seenByDomain.has(domain)) {
          isDuplicate = true;
        } else {
          seenByDomain.set(domain, place);
        }
      }
    }

    // Add to unique places if not duplicate
    // Note: name + city_id deduplication will happen during database upsert
    if (!isDuplicate) {
      uniquePlaces.push(place);
    }
  }

  return uniquePlaces;
}

export async function discoverBusinesses(
  input: DiscoveryInput,
  discoveryRunId?: string | null
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    businessesFound: 0,
    businessesCreated: 0,
    businessesSkipped: 0,
    businessesUpdated: 0,
    websitesCreated: 0,
    errors: []
  };

  try {
    // Validate dataset exists
    if (!input.datasetId) {
      throw new Error('Dataset ID is required for discovery');
    }

    const dataset = await getDatasetById(input.datasetId);
    if (!dataset) {
      throw new Error(`Dataset ${input.datasetId} not found`);
    }

    // Get Greece country
    const country = await getCountryByCode(GREECE_COUNTRY_CODE);
    if (!country) {
      throw new Error(`Country ${GREECE_COUNTRY_CODE} not found in database`);
    }

    // Resolve industry: prefer industry_id, fallback to industry name (legacy)
    let industry;
    if (input.industry_id) {
      industry = await getIndustryById(input.industry_id);
      if (!industry) {
        throw new Error(`Industry ${input.industry_id} not found`);
      }
    } else if (input.industry) {
      // Legacy: get or create by name
      industry = await getOrCreateIndustry(input.industry);
    } else {
      throw new Error('Either industry_id or industry name is required');
    }

    // Validate discovery_keywords
    if (!industry.discovery_keywords || industry.discovery_keywords.length === 0) {
      throw new Error(`Industry ${industry.id} has no discovery_keywords configured`);
    }

    console.log(`[discoverBusinesses] Using industry: ${industry.name} (${industry.id})`);
    console.log(`[discoverBusinesses] Discovery keywords: ${industry.discovery_keywords.join(', ')}`);

    // Resolve city: prefer city_id, fallback to city name (legacy)
    let city;
    let resolvedLatitude: number | undefined;
    let resolvedLongitude: number | undefined;
    let resolvedRadiusKm: number | undefined;

    if (input.city_id) {
      city = await getCityById(input.city_id);
      if (!city) {
        throw new Error(`City ${input.city_id} not found`);
      }
      resolvedLatitude = city.latitude || undefined;
      resolvedLongitude = city.longitude || undefined;
      resolvedRadiusKm = city.radius_km || undefined;
    } else if (input.city) {
      // Legacy: get or create by name
      const { normalizeCityName } = await import('../utils/cityNormalizer.js');
      const normalizedCityName = normalizeCityName(input.city);
      city = await getCityByNormalizedName(normalizedCityName);
      
      if (city?.latitude && city?.longitude && city?.radius_km) {
        resolvedLatitude = city.latitude;
        resolvedLongitude = city.longitude;
        resolvedRadiusKm = city.radius_km;
      } else {
        // Fetch coordinates from Google Places API
        console.log(`[discoverBusinesses] Resolving coordinates for city: ${input.city}`);
        const coordinates = await googleMapsService.getCityCoordinates(input.city);
        
        if (!coordinates) {
          throw new Error(`Could not resolve coordinates for city: ${input.city}`);
        }

        resolvedLatitude = coordinates.lat;
        resolvedLongitude = coordinates.lng;
        resolvedRadiusKm = coordinates.radiusKm;

        // Store coordinates in database
        if (city) {
          city = await updateCityCoordinates(city.id, coordinates);
        } else {
          city = await getOrCreateCity(input.city, country.id, coordinates);
        }
      }
    } else {
      // Use provided coordinates if available
      resolvedLatitude = input.latitude;
      resolvedLongitude = input.longitude;
      resolvedRadiusKm = input.cityRadiusKm;
    }

    // Validate coordinates are available
    if (!resolvedLatitude || !resolvedLongitude || !resolvedRadiusKm) {
      throw new Error('City coordinates (latitude, longitude, radius_km) are required for discovery');
    }

    console.log(`[discoverBusinesses] Using city: ${city?.name || 'coordinates'} (${resolvedLatitude}, ${resolvedLongitude}, radius: ${resolvedRadiusKm}km)`);

    // Fan-out: Search for each keyword
    const allPlaces: GooglePlaceResult[] = [];
    const keywordResults = new Map<string, number>();

    console.log(`[discoverBusinesses] Starting keyword fan-out (${industry.discovery_keywords.length} keywords)...`);

    // Limit concurrency to avoid overwhelming the API
    const CONCURRENCY_LIMIT = 3;
    const keywords = industry.discovery_keywords;

    for (let i = 0; i < keywords.length; i += CONCURRENCY_LIMIT) {
      const batch = keywords.slice(i, i + CONCURRENCY_LIMIT);
      
      const batchPromises = batch.map(async (keyword) => {
        try {
          const searchQuery = `${keyword} ${city?.name || ''} Greece`.trim();
          console.log(`[discoverBusinesses] Searching: "${searchQuery}"`);
          
          const location = {
            lat: resolvedLatitude!,
            lng: resolvedLongitude!
          };

          const places = await googleMapsService.searchPlaces(searchQuery, location);
          keywordResults.set(keyword, places.length);
          console.log(`[discoverBusinesses] Keyword "${keyword}": found ${places.length} places`);
          
          return places;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[discoverBusinesses] Error searching keyword "${keyword}":`, errorMsg);
          result.errors.push(`Keyword "${keyword}": ${errorMsg}`);
          keywordResults.set(keyword, 0);
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      for (const places of batchResults) {
        allPlaces.push(...places);
      }

      // Small delay between batches to respect rate limits
      if (i + CONCURRENCY_LIMIT < keywords.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Log keyword results
    console.log(`\n[discoverBusinesses] Keyword results:`);
    for (const [keyword, count] of keywordResults) {
      console.log(`  "${keyword}": ${count} places`);
    }

    // Deduplicate places BEFORE inserting
    console.log(`[discoverBusinesses] Deduplicating ${allPlaces.length} places...`);
    const uniquePlaces = deduplicatePlaces(allPlaces);
    console.log(`[discoverBusinesses] After deduplication: ${uniquePlaces.length} unique places`);

    result.businessesFound = uniquePlaces.length;

    // Process each unique place
    console.log(`\n[discoverBusinesses] Persisting ${uniquePlaces.length} businesses to database...`);
    console.log(`  Dataset ID: ${dataset.id}`);
    console.log(`  Owner User ID: ${dataset.user_id}`);
    if (discoveryRunId) {
      console.log(`  Discovery Run ID: ${discoveryRunId}`);
    }

    // Ensure we have city_id for all businesses
    const finalCityId = city?.id;
    if (!finalCityId) {
      throw new Error('City ID is required but could not be resolved');
    }

    for (const place of uniquePlaces) {
      try {
        await processPlace(
          place,
          country.id,
          industry.id,
          finalCityId,
          dataset.id,
          dataset.user_id,
          discoveryRunId,
          result
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Error processing place ${place.place_id || place.name}: ${errorMsg}`);
        console.error(`[discoverBusinesses] Error processing place ${place.place_id || place.name}:`, error);
      }
    }

    // Log persistence summary
    console.log(`\n[discoverBusinesses] Persistence Summary:`);
    console.log(`  Total places found: ${allPlaces.length}`);
    console.log(`  Unique places: ${uniquePlaces.length}`);
    console.log(`  Businesses inserted: ${result.businessesCreated}`);
    console.log(`  Businesses skipped (duplicates): ${result.businessesSkipped}`);
    console.log(`  Businesses updated: ${result.businessesUpdated}`);
    console.log(`  Websites created: ${result.websitesCreated}`);
    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Discovery error: ${errorMsg}`);
    console.error('[discoverBusinesses] Discovery error:', error);
  }

  return result;
}

async function processPlace(
  place: GooglePlaceResult,
  countryId: number,
  industryId: string, // UUID
  cityId: string, // UUID
  datasetId: string, // UUID
  ownerUserId: string,
  discoveryRunId: string | null | undefined,
  result: DiscoveryResult
): Promise<void> {
  // Extract postal code from address components
  let postalCode: string | null = null;

  if (place.address_components) {
    for (const component of place.address_components) {
      if (component.types.includes('postal_code')) {
        postalCode = component.short_name;
        break;
      }
    }
  }

  // Upsert business: Insert if new, Update if exists
  // Deduplication by: (dataset_id, normalized_name) or google_place_id
  const { business, wasUpdated } = await upsertBusiness({
    name: place.name,
    address: place.formatted_address || null,
    postal_code: postalCode,
    city_id: cityId,
    industry_id: industryId,
    google_place_id: place.place_id || null,
    dataset_id: datasetId,
    owner_user_id: ownerUserId,
    discovery_run_id: discoveryRunId || null
  });

  if (wasUpdated) {
    // Business was updated (existing record refreshed)
    result.businessesUpdated++;
  } else {
    // Business was inserted (new record)
    result.businessesCreated++;
  }

  // CRITICAL: Every discovered business MUST have at least one extraction_job
  // Create extraction job for ALL discovered businesses (both new and updated)
  // This ensures manual discovery, automatic discovery, and bulk/seed paths all create jobs
  // Do NOT skip job creation - every business needs extraction
  try {
    // Check if extraction job already exists for this business
    const { pool } = await import('../config/database.js');
    const existingJob = await pool.query(
      `SELECT id, discovery_run_id FROM extraction_jobs 
       WHERE business_id = $1 
       LIMIT 1`,
      [business.id]
    );

    if (existingJob.rows.length === 0) {
      // No extraction job exists - create one (always, even without discovery_run_id)
      await createExtractionJob(business.id, discoveryRunId || null);
      console.log(`[processPlace] Created extraction job for business ${business.id} (discovery_run_id: ${discoveryRunId || 'none'})`);
    } else if (discoveryRunId && !existingJob.rows[0].discovery_run_id) {
      // Extraction job exists but doesn't have discovery_run_id - update it
      await pool.query(
        `UPDATE extraction_jobs 
         SET discovery_run_id = $1 
         WHERE business_id = $2 
         AND discovery_run_id IS NULL
         LIMIT 1`,
        [discoveryRunId, business.id]
      );
      console.log(`[processPlace] Updated extraction job ${existingJob.rows[0].id} with discovery_run_id: ${discoveryRunId}`);
    }
  } catch (error) {
    console.error(`[processPlace] Error ensuring extraction job for business ${business.id}:`, error);
    // Don't fail the entire discovery if extraction job creation fails
    // But log it so we know there's an issue
  }

  // Create/update website if exists
  if (place.website) {
    try {
      const website = await getOrCreateWebsite(business.id, place.website);
      if (!website.business_id || website.business_id !== business.id) {
        result.websitesCreated++;
      }

      // Create crawl job for the website (discovery type)
      // Only create if this is a new business or if we want to re-crawl updated businesses
      if (!wasUpdated) {
        await createCrawlJob(website.id, 'discovery');
      }
    } catch (error) {
      console.error(`[processPlace] Error creating website for business ${business.id}:`, error);
    }
  }
}
