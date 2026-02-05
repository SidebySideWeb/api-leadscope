/**
 * Discovery Worker V2 - Grid-Based Discovery
 * 
 * Implements grid-based city coverage strategy:
 * - Generates grid of points covering the city
 * - Expands keywords (grid point × keyword = one search)
 * - Stops when new businesses drop below threshold
 * - Tracks coverage metrics
 * - Ensures idempotent discovery (no duplicates)
 */

import type { DiscoveryInput, City } from '../types/index.js';
import { googleMapsService } from '../services/googleMaps.js';
import { getCountryByCode } from '../db/countries.js';
import { getIndustryByName, getIndustryById } from '../db/industries.js';
import { getCityByNormalizedName, updateCityCoordinates, getCityById } from '../db/cities.js';
import { upsertBusinessGlobal, linkBusinessToDataset } from '../db/businessesShared.js';
import { getDatasetById } from '../db/datasets.js';
import { updateDiscoveryRun } from '../db/discoveryRuns.js';
import type { GooglePlaceResult } from '../types/index.js';
import { generateGridPoints, type GridPoint } from '../utils/geo.js';
import { getDiscoveryConfig, type DiscoveryConfig } from '../config/discoveryConfig.js';
import { calculateExportEstimates, calculateRefreshEstimates } from '../config/pricing.js';

const GREECE_COUNTRY_CODE = 'GR';

export interface DiscoveryResult {
  businessesFound: number;
  businessesCreated: number;
  businessesSkipped: number;
  businessesUpdated: number;
  errors: string[];
  // Coverage metrics
  gridPointsGenerated: number;
  searchesExecuted: number;
  uniqueBusinessesDiscovered: number;
  coverageScore: number; // Heuristic: unique businesses / grid points
  stoppedEarly: boolean;
  stopReason?: string;
  // Cost estimation (ESTIMATES ONLY - no billing occurs)
  estimatedBusinesses: number;
  completenessStats: {
    withWebsitePercent: number;
    withEmailPercent: number;
    withPhonePercent: number;
  };
  exportEstimates: Array<{
    size: number;
    priceEUR: number;
  }>;
  refreshEstimates: {
    incompleteOnly: {
      pricePerBusinessEUR: number;
      estimatedTotalEUR: number;
    };
    fullRefresh: {
      pricePerBusinessEUR: number;
      estimatedTotalEUR: number;
    };
  };
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
 * Deduplicate places by priority:
 * 1. google_place_id (primary)
 * 2. normalized name + city (secondary)
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
    if (!isDuplicate) {
      uniquePlaces.push(place);
    }
  }

  return uniquePlaces;
}

/**
 * Main discovery function with grid-based approach
 */
export async function discoverBusinessesV2(
  input: DiscoveryInput,
  discoveryRunId?: string | null,
  config?: Partial<DiscoveryConfig>
): Promise<DiscoveryResult> {
  console.log(`\n[discoverBusinessesV2] ===== DISCOVERY STARTED =====`);
  console.log(`[discoverBusinessesV2] Input:`, JSON.stringify({
    industry_id: input.industry_id,
    industry: input.industry,
    city_id: input.city_id,
    city: input.city,
    latitude: input.latitude,
    longitude: input.longitude,
    cityRadiusKm: input.cityRadiusKm,
    datasetId: input.datasetId
  }, null, 2));
  console.log(`[discoverBusinessesV2] Discovery Run ID:`, discoveryRunId);
  
  const discoveryConfig = { ...getDiscoveryConfig(), ...config };
  console.log(`[discoverBusinessesV2] Config:`, JSON.stringify(discoveryConfig, null, 2));
  
  const result: DiscoveryResult = {
    businessesFound: 0,
    businessesCreated: 0,
    businessesSkipped: 0,
    businessesUpdated: 0,
    errors: [],
    gridPointsGenerated: 0,
    searchesExecuted: 0,
    uniqueBusinessesDiscovered: 0,
    coverageScore: 0,
    stoppedEarly: false,
    // Cost estimation (will be calculated after discovery)
    estimatedBusinesses: 0,
    completenessStats: {
      withWebsitePercent: 0,
      withEmailPercent: 0,
      withPhonePercent: 0,
    },
    exportEstimates: [],
    refreshEstimates: {
      incompleteOnly: {
        pricePerBusinessEUR: 0,
        estimatedTotalEUR: 0,
      },
      fullRefresh: {
        pricePerBusinessEUR: 0,
        estimatedTotalEUR: 0,
      },
    },
  };

  try {
    // CRITICAL: Validate discovery_run_id is provided
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

    // Resolve industry - must exist, won't create
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

    console.log(`[discoverBusinessesV2] Using industry: ${industry.name} (${industry.id})`);
    console.log(`[discoverBusinessesV2] Discovery keywords: ${industry.discovery_keywords.join(', ')}`);

    // Resolve city and coordinates
    let city: City | null = null;
    let resolvedLatitude: number | undefined;
    let resolvedLongitude: number | undefined;
    let resolvedRadiusKm: number | undefined;

    if (input.city_id) {
      city = await getCityById(input.city_id);
      if (!city) {
        throw new Error(`City ${input.city_id} not found`);
      }
      // CRITICAL: Convert to numbers - database may return strings or numbers
      resolvedLatitude = city.latitude ? (typeof city.latitude === 'string' ? parseFloat(city.latitude) : Number(city.latitude)) : undefined;
      resolvedLongitude = city.longitude ? (typeof city.longitude === 'string' ? parseFloat(city.longitude) : Number(city.longitude)) : undefined;
      resolvedRadiusKm = city.radius_km ? (typeof city.radius_km === 'string' ? parseFloat(city.radius_km) : Number(city.radius_km)) : undefined;
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
        console.log(`[discoverBusinessesV2] Resolving coordinates for existing city: ${input.city}`);
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
      // CRITICAL: Convert string coordinates to numbers if needed
      // API may send coordinates as strings (e.g., "37.98380000")
      resolvedLatitude = typeof input.latitude === 'string' ? parseFloat(input.latitude) : input.latitude;
      resolvedLongitude = typeof input.longitude === 'string' ? parseFloat(input.longitude) : input.longitude;
      resolvedRadiusKm = typeof input.cityRadiusKm === 'string' ? parseFloat(input.cityRadiusKm) : input.cityRadiusKm;
    }

    // Validate coordinates (check for NaN after conversion)
    if (!resolvedLatitude || !resolvedLongitude || !resolvedRadiusKm || 
        isNaN(resolvedLatitude) || isNaN(resolvedLongitude) || isNaN(resolvedRadiusKm)) {
      throw new Error(`City coordinates (latitude, longitude, radius_km) are required for discovery. Got: lat=${resolvedLatitude}, lng=${resolvedLongitude}, radius=${resolvedRadiusKm}`);
    }

    const finalCityId = city?.id;
    if (!finalCityId) {
      throw new Error('City ID is required but could not be resolved');
    }

    console.log(`[discoverBusinessesV2] Using city: ${city?.name || 'coordinates'} (${resolvedLatitude}, ${resolvedLongitude}, radius: ${resolvedRadiusKm}km)`);
    console.log(`[discoverBusinessesV2] Grid config: radius=${discoveryConfig.gridRadiusKm}km, density=${discoveryConfig.gridDensity}km`);
    console.log(`[discoverBusinessesV2] Coordinate types: lat=${typeof resolvedLatitude}, lng=${typeof resolvedLongitude}, radius=${typeof resolvedRadiusKm}`);
    console.log(`[discoverBusinessesV2] Coordinate values: lat=${resolvedLatitude}, lng=${resolvedLongitude}, radius=${resolvedRadiusKm}`);

    // STEP 1: Generate grid points covering the city
    const gridPoints = generateGridPoints(
      resolvedLatitude,
      resolvedLongitude,
      resolvedRadiusKm,
      discoveryConfig.gridDensity
    );
    result.gridPointsGenerated = gridPoints.length;
    console.log(`[discoverBusinessesV2] Generated ${gridPoints.length} grid points`);
    
    if (gridPoints.length === 0) {
      console.error(`[discoverBusinessesV2] ⚠️⚠️⚠️ GRID GENERATION FAILED ⚠️⚠️⚠️`);
      console.error(`[discoverBusinessesV2] This will cause 0 businesses to be discovered`);
      console.error(`[discoverBusinessesV2] Check: coordinates are valid numbers, radius > 0, step > 0`);
    }

    // STEP 2: Expand keywords (grid point × keyword = one search)
    const searchTasks: Array<{ gridPoint: GridPoint; keyword: string }> = [];
    for (const gridPoint of gridPoints) {
      for (const keyword of industry.discovery_keywords) {
        searchTasks.push({ gridPoint, keyword });
      }
    }

    // Limit total searches
    const maxSearches = Math.min(searchTasks.length, discoveryConfig.maxSearchesPerDataset);
    const limitedSearchTasks = searchTasks.slice(0, maxSearches);
    console.log(`[discoverBusinessesV2] Total search tasks: ${limitedSearchTasks.length} (${gridPoints.length} points × ${industry.discovery_keywords.length} keywords, limited to ${maxSearches})`);

    // STEP 3: Execute searches with stop conditions
    console.log(`[discoverBusinessesV2] ===== STARTING GOOGLE PLACES SEARCHES =====`);
    console.log(`[discoverBusinessesV2] Total search tasks: ${limitedSearchTasks.length}`);
    console.log(`[discoverBusinessesV2] Batch size: ${discoveryConfig.concurrency}`);
    
    const allPlaces: GooglePlaceResult[] = [];
    const seenPlaceIds = new Set<string>();
    let consecutiveLowYieldBatches = 0;
    const BATCH_SIZE = discoveryConfig.concurrency;
    const MIN_NEW_PERCENT = discoveryConfig.minNewBusinessesPercent;

    for (let i = 0; i < limitedSearchTasks.length; i += BATCH_SIZE) {
      const batch = limitedSearchTasks.slice(i, i + BATCH_SIZE);
      const batchStartUniqueCount = seenPlaceIds.size;

      // Execute batch
      const batchPromises = batch.map(async (task) => {
        try {
          // CRITICAL FIX: Add city name to query for better results
          // Google Places API works better with contextual queries
          const cityName = city?.name || '';
          const searchQuery = cityName ? `${task.keyword} ${cityName}` : task.keyword;
          const radiusMeters = discoveryConfig.gridRadiusKm * 1000; // Convert km to meters
          
          console.log(`[discoverBusinessesV2] Searching: "${searchQuery}" at (${task.gridPoint.lat}, ${task.gridPoint.lng}) radius ${radiusMeters}m`);
          
          const places = await searchWithRetry(
            searchQuery,
            task.gridPoint,
            radiusMeters,
            discoveryConfig
          );

          // CRITICAL DEBUG: Log raw Google results
          console.log(`[discoverBusinessesV2] RAW GOOGLE PLACES for "${searchQuery}": ${places.length}`);
          if (places.length > 0) {
            console.log(`[discoverBusinessesV2] Sample place IDs: ${places.slice(0, 3).map(p => p.place_id || 'NO_ID').join(', ')}`);
            console.log(`[discoverBusinessesV2] Sample place names: ${places.slice(0, 3).map(p => p.name || 'NO_NAME').join(', ')}`);
          } else {
            console.warn(`[discoverBusinessesV2] WARNING: Search "${searchQuery}" returned ZERO places`);
          }

          result.searchesExecuted++;
          return places;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[discoverBusinessesV2] Search failed for "${task.keyword}" at (${task.gridPoint.lat}, ${task.gridPoint.lng}): ${errorMsg}`);
          result.errors.push(`Grid point (${task.gridPoint.lat}, ${task.gridPoint.lng}) keyword "${task.keyword}": ${errorMsg}`);
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      
      // CRITICAL DEBUG: Log total places before filtering
      const totalPlacesBeforeFilter = batchResults.reduce((sum, places) => sum + places.length, 0);
      console.log(`[discoverBusinessesV2] BEFORE FILTER: ${totalPlacesBeforeFilter} total places from batch`);

      // Deduplicate batch results
      // TEMPORARILY DISABLED FILTERING FOR DEBUGGING: Accept all places even without place_id
      let batchNewCount = 0;
      let batchSkippedNoPlaceId = 0;
      for (const places of batchResults) {
        for (const place of places) {
          // CRITICAL: Check for missing or empty place_id
          // Empty strings are falsy, so we need to check explicitly
          if (!place.place_id || place.place_id.trim() === '') {
            batchSkippedNoPlaceId++;
            console.warn(`[discoverBusinessesV2] WARNING: Place without valid place_id:`, {
              name: place.name || 'unnamed',
              place_id: place.place_id,
              formatted_address: place.formatted_address,
              fullPlace: JSON.stringify(place, null, 2)
            });
            // Generate a temp ID so we can still track it
            const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            place.place_id = tempId;
            console.log(`[discoverBusinessesV2] TEMP: Generated temp ID ${tempId} for place: ${place.name}`);
          }
          
          if (!seenPlaceIds.has(place.place_id!)) {
            seenPlaceIds.add(place.place_id!);
            allPlaces.push(place);
            batchNewCount++;
          }
        }
      }

      // CRITICAL DEBUG: Log after filtering
      console.log(`[discoverBusinessesV2] AFTER FILTER: ${batchNewCount} new places added (${batchSkippedNoPlaceId} skipped due to no place_id)`);

      const batchEndUniqueCount = seenPlaceIds.size;
      const batchTotalFound = batchResults.reduce((sum, places) => sum + places.length, 0);
      const batchNewPercent = batchTotalFound > 0 ? (batchNewCount / batchTotalFound) * 100 : 0;

      console.log(`[discoverBusinessesV2] Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchNewCount} new, ${batchTotalFound} total, ${batchSkippedNoPlaceId} skipped (no place_id), ${batchNewPercent.toFixed(1)}% new`);

      // Stop condition: If new businesses < threshold, stop expanding
      if (batchNewPercent < MIN_NEW_PERCENT && batchTotalFound > 0) {
        consecutiveLowYieldBatches++;
        if (consecutiveLowYieldBatches >= 3) {
          result.stoppedEarly = true;
          result.stopReason = `Stopped early: ${consecutiveLowYieldBatches} consecutive batches with <${MIN_NEW_PERCENT}% new businesses`;
          console.log(`[discoverBusinessesV2] ${result.stopReason}`);
          break;
        }
      } else {
        consecutiveLowYieldBatches = 0;
      }

      // Rate limiting delay
      if (i + BATCH_SIZE < limitedSearchTasks.length) {
        await new Promise(resolve => setTimeout(resolve, discoveryConfig.requestDelayMs));
      }
    }

    // CRITICAL DEBUG: Log before final deduplication
    console.log(`[discoverBusinessesV2] ===== BEFORE FINAL DEDUP =====`);
    console.log(`[discoverBusinessesV2] Total places collected from Google: ${allPlaces.length}`);
    if (allPlaces.length === 0) {
      console.error(`[discoverBusinessesV2] ⚠️⚠️⚠️ ZERO PLACES FROM GOOGLE PLACES API ⚠️⚠️⚠️`);
      console.error(`[discoverBusinessesV2] This means Google Places API returned no results`);
      console.error(`[discoverBusinessesV2] Check: API key, search queries, location, radius`);
    } else {
      console.log(`[discoverBusinessesV2] Sample place IDs: ${allPlaces.slice(0, 5).map(p => p.place_id || 'NO_ID').join(', ')}`);
    }

    // STEP 4: Final deduplication
    console.log(`[discoverBusinessesV2] Deduplicating ${allPlaces.length} places...`);
    const uniquePlaces = deduplicatePlaces(allPlaces);
    result.uniqueBusinessesDiscovered = uniquePlaces.length;
    result.businessesFound = uniquePlaces.length;
    
    // CRITICAL DEBUG: Log after deduplication
    console.log(`[discoverBusinessesV2] ===== AFTER FINAL DEDUP =====`);
    console.log(`[discoverBusinessesV2] Unique places: ${uniquePlaces.length}`);
    console.log(`[discoverBusinessesV2] Duplicates dropped: ${allPlaces.length - uniquePlaces.length}`);
    
    if (uniquePlaces.length === 0) {
      console.error(`[discoverBusinessesV2] ⚠️⚠️⚠️ ZERO UNIQUE PLACES AFTER DEDUP ⚠️⚠️⚠️`);
      console.error(`[discoverBusinessesV2] This means all places were duplicates or invalid`);
    }

    // Calculate coverage score
    result.coverageScore = result.gridPointsGenerated > 0
      ? result.uniqueBusinessesDiscovered / result.gridPointsGenerated
      : 0;

    // STEP 4.5: Calculate completeness stats from discovered places
    // Note: Discovery phase doesn't fetch website/phone/email (requires Place Details API)
    // We estimate based on what's available in the Google Places response
    let withWebsiteCount = 0;
    let withPhoneCount = 0;
    // Email is never in Google Places response - we estimate based on historical data
    const estimatedEmailPercent = 25; // Conservative estimate: 25% of businesses have email
    
    for (const place of uniquePlaces) {
      if (place.website) withWebsiteCount++;
      if (place.international_phone_number) withPhoneCount++;
    }
    
    const totalPlaces = uniquePlaces.length;
    result.completenessStats = {
      withWebsitePercent: totalPlaces > 0 
        ? Math.round((withWebsiteCount / totalPlaces) * 100 * 100) / 100 
        : 0,
      withEmailPercent: estimatedEmailPercent, // Estimated - requires extraction/crawling
      withPhonePercent: totalPlaces > 0 
        ? Math.round((withPhoneCount / totalPlaces) * 100 * 100) / 100 
        : 0,
    };
    
    // Calculate estimated businesses (use uniqueBusinessesDiscovered)
    result.estimatedBusinesses = result.uniqueBusinessesDiscovered;
    
    // Calculate export estimates (only include sizes <= estimatedBusinesses)
    result.exportEstimates = calculateExportEstimates(result.estimatedBusinesses);
    
    // Calculate refresh estimates
    // Estimate incomplete rate: businesses missing website OR email OR phone
    // Conservative estimate: 30% of businesses are incomplete
    const incompleteRate = 0.3;
    result.refreshEstimates = calculateRefreshEstimates(
      result.estimatedBusinesses,
      incompleteRate
    );
    
    console.log(`[discoverBusinessesV2] Cost Estimation:`);
    console.log(`  Estimated businesses: ${result.estimatedBusinesses}`);
    console.log(`  Completeness: website=${result.completenessStats.withWebsitePercent}%, email=${result.completenessStats.withEmailPercent}%, phone=${result.completenessStats.withPhonePercent}%`);
    console.log(`  Export estimates: ${result.exportEstimates.length} tiers available`);
    console.log(`  Refresh estimates: incompleteOnly=€${result.refreshEstimates.incompleteOnly.estimatedTotalEUR}, fullRefresh=€${result.refreshEstimates.fullRefresh.estimatedTotalEUR}`);

    // STEP 5: Process and persist businesses (GLOBAL, not per-dataset)
    // Discovery performs UPSERT by google_place_id globally
    // Then links businesses to dataset via dataset_businesses junction table
    console.log(`\n[discoverBusinessesV2] Persisting ${uniquePlaces.length} businesses globally...`);
    console.log(`[discoverBusinessesV2] CRITICAL: Discovery is enrichment-only - no crawling triggered`);
    
    // CRITICAL DEBUG: Log businesses to insert
    console.log(`[discoverBusinessesV2] BUSINESSES TO INSERT: ${uniquePlaces.length}`);
    
    console.log('🚨 ABOUT TO INSERT BUSINESSES', {
      count: uniquePlaces.length,
      sample: uniquePlaces[0],
    });
    
    if (uniquePlaces.length === 0) {
      console.error(`[discoverBusinessesV2] ⚠️⚠️⚠️ CANNOT INSERT - ZERO PLACES ⚠️⚠️⚠️`);
      console.error(`[discoverBusinessesV2] No businesses to insert. Check Google Places API results above.`);
    }
    
    let businessesInserted = 0;
    let businessesSkipped = 0;
    
    for (const place of uniquePlaces) {
      try {
        // TEMPORARILY DISABLED: Accept places even without place_id for debugging
        // CRITICAL: Check for missing or empty place_id (empty strings are falsy)
        if (!place.place_id || place.place_id.trim() === '') {
          businessesSkipped++;
          console.warn(`[discoverBusinessesV2] WARNING: Skipping place without valid google_place_id:`, {
            name: place.name,
            place_id: place.place_id,
            formatted_address: place.formatted_address,
            hasLocation: !!(place.latitude && place.longitude),
            fullPlace: JSON.stringify(place, null, 2)
          });
          continue;
        }

        // Extract postal code
        let postalCode: string | null = null;
        if (place.address_components) {
          for (const component of place.address_components) {
            if (component.types.includes('postal_code')) {
              postalCode = component.short_name;
              break;
            }
          }
        }

        // CRITICAL: city_id is NOT NULL in database - must be provided from discovery context
        // Fail fast if city_id is missing instead of causing silent rollback
        if (!finalCityId || finalCityId.trim().length === 0) {
          throw new Error(`city_id missing in discovery insert for business "${place.name}" - City ID must be provided from discovery context`);
        }

        // UPSERT business globally by google_place_id
        // This ensures businesses are never duplicated
        // Discovery only enriches metadata - does NOT fetch website/phone (Place Details API)
        const { business, wasUpdated, wasNew } = await upsertBusinessGlobal({
          name: place.name,
          address: place.formatted_address || null,
          postal_code: postalCode,
          city_id: finalCityId, // CRITICAL: Required - businesses.city_id is NOT NULL
          industry_id: industry.id, // CRITICAL: Required - businesses.industry_id is NOT NULL
          dataset_id: dataset.id, // CRITICAL: Required - businesses.dataset_id is NOT NULL
          google_place_id: place.place_id,
          owner_user_id: dataset.user_id, // CRITICAL: Required - businesses.owner_user_id is NOT NULL
          discovery_run_id: discoveryRunId || null, // Link business to discovery run
          latitude: place.latitude || resolvedLatitude || null, // Use place location or city center as fallback
          longitude: place.longitude || resolvedLongitude || null, // Use place location or city center as fallback
          rating: place.rating || undefined,
          user_rating_count: place.user_rating_count || undefined
        });

        if (wasNew) {
          result.businessesCreated++;
          businessesInserted++;
          console.log(`[discoverBusinessesV2] ✓ Created new business: ${business.id} (${place.name})`);
        } else if (wasUpdated) {
          result.businessesUpdated++;
          businessesInserted++;
          console.log(`[discoverBusinessesV2] ✓ Updated existing business: ${business.id} (${place.name})`);
        }

        // Link business to dataset via junction table
        // This creates the many-to-many relationship (datasets are views over businesses)
        await linkBusinessToDataset(business.id, dataset.id, dataset.user_id);

      } catch (error) {
        // CRITICAL: Fail fast on insert/upsert errors - do not swallow database errors
        // Discovery that inserts 0 rows is a failure, not success
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[discoverBusinessesV2] FATAL insert error', error);
        console.error(`[discoverBusinessesV2] Error processing place ${place.place_id || place.name}:`, error);
        result.errors.push(`FATAL: Error processing place ${place.place_id || place.name}: ${errorMsg}`);
        // Re-throw to fail fast - do not continue loop after fatal insert failure
        throw error;
      }
    }

    console.log('✅ INSERT ATTEMPT FINISHED');

    // CRITICAL DEBUG: Final insertion summary
    console.log(`\n[discoverBusinessesV2] ===== INSERTION SUMMARY =====`);
    console.log(`[discoverBusinessesV2] Businesses inserted: ${businessesInserted}`);
    console.log(`[discoverBusinessesV2] Businesses skipped: ${businessesSkipped}`);
    console.log(`[discoverBusinessesV2] Total unique places: ${uniquePlaces.length}`);
    console.log(`[discoverBusinessesV2] ==============================`);

    // STEP 6: Discovery does NOT create extraction jobs automatically
    // Extraction jobs are created:
    // - On export (if user requests refresh)
    // - On paid refresh
    // - Via explicit crawl trigger
    // 
    // Discovery only enriches business metadata, never triggers crawling
    console.log(`[discoverBusinessesV2] Discovery complete - no extraction jobs created (enrichment-only)`);

    // Mark discovery_run as completed and store cost estimates
    if (discoveryRunId) {
      try {
        await updateDiscoveryRun(discoveryRunId, {
          status: 'completed',
          completed_at: new Date(),
          cost_estimates: {
            estimatedBusinesses: result.estimatedBusinesses,
            completenessStats: result.completenessStats,
            exportEstimates: result.exportEstimates,
            refreshEstimates: result.refreshEstimates,
          },
        });
        console.log(`[discoverBusinessesV2] Marked discovery_run ${discoveryRunId} as completed with cost estimates`);
      } catch (updateError) {
        const updateErrorMsg = updateError instanceof Error ? updateError.message : String(updateError);
        console.error(`[discoverBusinessesV2] Error updating discovery_run status:`, updateErrorMsg);
        result.errors.push(`Failed to update discovery_run status: ${updateErrorMsg}`);
      }
    }

    // Log summary
    console.log(`\n[discoverBusinessesV2] Discovery Summary:`);
    console.log(`  Grid points: ${result.gridPointsGenerated}`);
    console.log(`  Searches executed: ${result.searchesExecuted}`);
    console.log(`  Unique businesses: ${result.uniqueBusinessesDiscovered}`);
    console.log(`  Coverage score: ${result.coverageScore.toFixed(2)}`);
    console.log(`  Businesses created: ${result.businessesCreated}`);
    console.log(`  Businesses updated: ${result.businessesUpdated}`);
    if (result.stoppedEarly) {
      console.log(`  Stopped early: ${result.stopReason}`);
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : 'No stack trace';
    result.errors.push(`Discovery error: ${errorMsg}`);
    console.error('[discoverBusinessesV2] ===== DISCOVERY ERROR =====');
    console.error('[discoverBusinessesV2] Error message:', errorMsg);
    console.error('[discoverBusinessesV2] Error stack:', errorStack);
    console.error('[discoverBusinessesV2] Full error object:', error);
    
    if (discoveryRunId) {
      try {
        await updateDiscoveryRun(discoveryRunId, {
          status: 'failed',
          completed_at: new Date(),
          error_message: errorMsg,
          // Store partial estimates if available
          cost_estimates: result.estimatedBusinesses > 0 ? {
            estimatedBusinesses: result.estimatedBusinesses,
            completenessStats: result.completenessStats,
            exportEstimates: result.exportEstimates,
            refreshEstimates: result.refreshEstimates,
          } : null,
        });
        console.log(`[discoverBusinessesV2] Marked discovery_run ${discoveryRunId} as failed`);
      } catch (updateError) {
        console.error(`[discoverBusinessesV2] Error updating discovery_run to failed status:`, updateError);
      }
    }
  }

  return result;
}

/**
 * Search with retry logic
 */
async function searchWithRetry(
  query: string,
  location: GridPoint,
  radiusMeters: number,
  config: DiscoveryConfig
): Promise<GooglePlaceResult[]> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
    try {
      return await googleMapsService.searchPlaces(query, {
        lat: location.lat,
        lng: location.lng
      }, radiusMeters);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < config.retryAttempts) {
        const delay = config.retryDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Search failed after retries');
}

// processPlace function removed - logic moved inline to main discovery function
// Discovery now uses upsertBusinessGlobal and linkBusinessToDataset
