import type { DiscoveryInput, City } from '../types/index.js';
import { googleMapsService } from '../services/googleMaps.js';
import { getCountryByCode } from '../db/countries.js';
import { getIndustryByName, getIndustryById } from '../db/industries.js';
import { getCityByNormalizedName, updateCityCoordinates, getCityById } from '../db/cities.js';
import { getBusinessByGooglePlaceId, upsertBusiness, getBusinessesWithCompleteData } from '../db/businesses.js';
import { getDatasetById } from '../db/datasets.js';
import { updateDiscoveryRun } from '../db/discoveryRuns.js';
import type { GooglePlaceResult } from '../types/index.js';

const GREECE_COUNTRY_CODE = 'GR';

export interface DiscoveryResult {
  businessesFound: number;
  businessesCreated: number;
  businessesSkipped: number;
  businessesUpdated: number;
  errors: string[];
  // Note: websitesCreated removed - websites are created in extraction phase, not discovery
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
    errors: []
  };

  try {
    // CRITICAL: Validate discovery_run_id is provided
    // Every business created during discovery MUST be linked to a discovery_run
    if (!discoveryRunId) {
      throw new Error('discovery_run_id is required for discovery. Cannot create businesses without linking them to a discovery_run.');
    }

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
      // Legacy support: look up industry by name, but don't create if not found
      industry = await getIndustryByName(input.industry);
      if (!industry) {
        throw new Error(`Industry "${input.industry}" not found. Please use an existing industry ID instead.`);
      }
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
    let city: City | null = null;
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
      // Legacy support: look up city by name, but don't create if not found
      const { normalizeCityName } = await import('../utils/cityNormalizer.js');
      const normalizedCityName = normalizeCityName(input.city);
      city = await getCityByNormalizedName(normalizedCityName);
      
      if (!city) {
        throw new Error(`City "${input.city}" not found. Please use an existing city ID instead.`);
      }
      
      // Use city coordinates if available
      if (city.latitude && city.longitude && city.radius_km) {
        resolvedLatitude = city.latitude;
        resolvedLongitude = city.longitude;
        resolvedRadiusKm = city.radius_km;
      } else {
        // City exists but missing coordinates - update them
        console.log(`[discoverBusinesses] Resolving coordinates for existing city: ${input.city}`);
        const coordinates = await googleMapsService.getCityCoordinates(input.city);
        
        if (!coordinates) {
          throw new Error(`Could not resolve coordinates for city: ${input.city}`);
        }

        resolvedLatitude = coordinates.lat;
        resolvedLongitude = coordinates.lng;
        resolvedRadiusKm = coordinates.radiusKm;

        // Update existing city with coordinates
        city = await updateCityCoordinates(city.id, coordinates);
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

    // Ensure we have city_id
    const finalCityId = city?.id;
    if (!finalCityId) {
      throw new Error('City ID is required but could not be resolved');
    }

    // Always run Google Maps API search to get fresh results (new businesses may have been added)
    // But we'll skip extraction for businesses that already have complete data
    console.log(`[discoverBusinesses] Starting Google Maps API search (always runs to catch new businesses)...`);

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

    // Check which businesses already have complete data (website + contacts)
    // We'll skip extraction for these businesses
    const placeIdsWithData = uniquePlaces
      .map(p => p.place_id)
      .filter((id): id is string => id !== undefined && id !== null);
    
    console.log(`[discoverBusinesses] Checking ${placeIdsWithData.length} businesses for existing complete data...`);
    const businessesWithCompleteData = await getBusinessesWithCompleteData(placeIdsWithData);
    console.log(`[discoverBusinesses] Found ${businessesWithCompleteData.size} businesses with complete data (will skip extraction)`);

    // Process each unique place
    console.log(`\n[discoverBusinesses] Persisting ${uniquePlaces.length} businesses to database...`);
    console.log(`  Dataset ID: ${dataset.id}`);
    console.log(`  Owner User ID: ${dataset.user_id}`);
    if (discoveryRunId) {
      console.log(`  Discovery Run ID: ${discoveryRunId}`);
    }

    // finalCityId is already defined above (for cache check)

    // Process all places and insert businesses
    for (const place of uniquePlaces) {
      try {
        const hasCompleteData = place.place_id ? businessesWithCompleteData.has(place.place_id) : false;
        
        await processPlace(
          place,
          country.id,
          industry.id,
          finalCityId,
          dataset.id,
          dataset.user_id,
          discoveryRunId,
          result,
          hasCompleteData
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Error processing place ${place.place_id || place.name}: ${errorMsg}`);
        console.error(`[discoverBusinesses] Error processing place ${place.place_id || place.name}:`, error);
      }
    }

    // CRITICAL: Create extraction_jobs AFTER all businesses are processed
    // Enqueue extraction jobs ONLY for businesses that don't have complete data
    // NOTE: extraction_jobs does NOT have discovery_run_id - use businesses.discovery_run_id to link
    if (discoveryRunId) {
      console.log(`\n[discoverBusinesses] Enqueuing extraction_jobs for businesses in discovery_run: ${discoveryRunId}...`);
      console.log(`[discoverBusinesses] Skipping businesses that already have complete data (website + contacts)...`);
      
      try {
        const { pool } = await import('../config/database.js');
        // Only create extraction jobs for businesses that don't have complete data
        const insertResult = await pool.query<{ id: string }>(
          `INSERT INTO extraction_jobs (business_id, status, created_at)
           SELECT b.id, 'pending', NOW()
           FROM businesses b
           WHERE b.discovery_run_id = $1
             -- Skip businesses that already have website + contacts
             AND NOT (
               EXISTS (SELECT 1 FROM websites w WHERE w.business_id = b.id)
               AND EXISTS (
                 SELECT 1 
                 FROM contact_sources cs
                 JOIN contacts c ON c.id = cs.contact_id
                 WHERE cs.business_id = b.id::text
                   AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
               )
             )
           ON CONFLICT (business_id) DO NOTHING
           RETURNING id`,
          [discoveryRunId]
        );
        
        const extractionJobsCreated = insertResult.rows.length;
        console.log(`[discoverBusinesses] Enqueued ${extractionJobsCreated} extraction_jobs for discovery_run: ${discoveryRunId}`);
        
        // Count how many businesses were skipped due to complete data
        const skippedCount = await pool.query<{ count: string }>(
          `SELECT COUNT(*) as count 
           FROM businesses b
           WHERE b.discovery_run_id = $1
             AND EXISTS (SELECT 1 FROM websites w WHERE w.business_id = b.id)
             AND EXISTS (
               SELECT 1 
               FROM contact_sources cs
               JOIN contacts c ON c.id = cs.contact_id
               WHERE cs.business_id = b.id::text
                 AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
             )`,
          [discoveryRunId]
        );
        const skipped = parseInt(skippedCount.rows[0]?.count || '0', 10);
        if (skipped > 0) {
          console.log(`[discoverBusinesses] Skipped ${skipped} businesses with complete data (no extraction needed)`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[discoverBusinesses] Error enqueuing extraction jobs:`, errorMsg);
        result.errors.push(`Failed to enqueue extraction jobs: ${errorMsg}`);
      }

      // CRITICAL: Discovery MUST ALWAYS complete after enqueuing extraction jobs
      // Mark discovery_run as 'completed' regardless of whether businesses were found or errors occurred
      // Even if 0 businesses were found, discovery is complete (no businesses to extract)
      try {
        await updateDiscoveryRun(discoveryRunId, {
          status: 'completed',
          completed_at: new Date()
        });
        console.log(`[discoverBusinesses] Marked discovery_run ${discoveryRunId} as completed`);
        
        // CRITICAL: Trigger extraction immediately after discovery completes
        // Extraction should start processing extraction_jobs right away
        try {
          const { runExtractionBatch } = await import('../workers/extractWorker.js');
          const EXTRACTION_BATCH_SIZE = parseInt(process.env.EXTRACTION_BATCH_SIZE || '5', 10);
          
          console.log(`[discoverBusinesses] Triggering extraction worker for discovery_run ${discoveryRunId}...`);
          // Run extraction asynchronously (don't wait for it to complete)
          // This allows discovery to complete while extraction runs in background
          runExtractionBatch(EXTRACTION_BATCH_SIZE).catch((extractError) => {
            const extractErrorMsg = extractError instanceof Error ? extractError.message : String(extractError);
            console.error(`[discoverBusinesses] Error in extraction worker:`, extractErrorMsg);
            // Don't fail discovery if extraction fails - extraction will retry via periodic worker
          });
        } catch (importError) {
          const importErrorMsg = importError instanceof Error ? importError.message : String(importError);
          console.error(`[discoverBusinesses] Error importing extraction worker:`, importErrorMsg);
          // Don't fail discovery if extraction worker can't be imported
        }
      } catch (updateError) {
        const updateErrorMsg = updateError instanceof Error ? updateError.message : String(updateError);
        console.error(`[discoverBusinesses] Error updating discovery_run status:`, updateErrorMsg);
        result.errors.push(`Failed to update discovery_run status: ${updateErrorMsg}`);
        // Don't throw - discovery is still considered complete even if status update fails
      }
    }

    // Log persistence summary
    console.log(`\n[discoverBusinesses] Persistence Summary:`);
    console.log(`  Total places found: ${allPlaces.length}`);
    console.log(`  Unique places: ${uniquePlaces.length}`);
    console.log(`  Businesses inserted: ${result.businessesCreated}`);
    console.log(`  Businesses skipped (duplicates): ${result.businessesSkipped}`);
    console.log(`  Businesses updated: ${result.businessesUpdated}`);
    // Note: Websites are created in extraction phase, not discovery
    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Discovery error: ${errorMsg}`);
    console.error('[discoverBusinesses] Discovery error:', error);
    
    // CRITICAL: On errors, mark discovery_run as 'failed'
    // Discovery MUST always end in 'completed' or 'failed', never stuck in 'running'
    if (discoveryRunId) {
      try {
        await updateDiscoveryRun(discoveryRunId, {
          status: 'failed',
          completed_at: new Date(),
          error_message: errorMsg
        });
        console.log(`[discoverBusinesses] Marked discovery_run ${discoveryRunId} as failed due to error`);
      } catch (updateError) {
        const updateErrorMsg = updateError instanceof Error ? updateError.message : String(updateError);
        console.error(`[discoverBusinesses] Error updating discovery_run to failed status:`, updateErrorMsg);
        // Don't throw - we've already logged the error
      }
    }
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
  result: DiscoveryResult,
  hasCompleteData: boolean = false
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

  // CRITICAL: discoveryRunId must be provided (validated at function entry)
  // Every business MUST be linked to the discovery_run
  if (!discoveryRunId) {
    throw new Error(`[processPlace] discovery_run_id is required but was not provided. Cannot create business ${place.name} without linking it to a discovery_run.`);
  }

  // Upsert business: Insert if new, Update if exists
  // Deduplication by: (dataset_id, normalized_name) or google_place_id
  // ALWAYS include discovery_run_id - this is mandatory for discovery-created businesses
  const { business, wasUpdated } = await upsertBusiness({
    name: place.name,
    address: place.formatted_address || null,
    postal_code: postalCode,
    city_id: cityId,
    industry_id: industryId,
    google_place_id: place.place_id || null,
    dataset_id: datasetId,
    owner_user_id: ownerUserId,
    discovery_run_id: discoveryRunId // REQUIRED - never null during discovery
  });

  if (wasUpdated) {
    // Business was updated (existing record refreshed)
    result.businessesUpdated++;
  } else {
    // Business was inserted (new record)
    result.businessesCreated++;
  }

  // CRITICAL: If business already has complete data (website + contacts), skip extraction
  // We still add the business to the dataset, but don't create extraction job
  // This avoids redundant crawling/extraction work
  if (hasCompleteData && place.place_id) {
    console.log(`[processPlace] Skipping extraction for business ${business.id} (${place.name}) - already has complete data`);
    // Don't create extraction job - business already has website + contacts
    return;
  }

  // CRITICAL: Discovery phase does NOT have website/phone data
  // These are only available from Place Details API, which is NOT called during discovery
  // Website/phone will be fetched in extraction phase if needed
  // Do NOT try to create website here - it doesn't exist in Text Search results
  // Extraction jobs are created AFTER all businesses are processed (in batch via SQL)
}
