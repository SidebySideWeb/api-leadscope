import type { DiscoveryInput } from '../types/index.js';
import { googleMapsService } from '../services/googleMaps.js';
import { geoGridDiscoveryService } from '../services/geoGrid.js';
import { getCountryByCode } from '../db/countries.js';
import { getOrCreateIndustry } from '../db/industries.js';
import { getOrCreateCity, getCityByNormalizedName, updateCityCoordinates } from '../db/cities.js';
import { getBusinessByGooglePlaceId, upsertBusiness } from '../db/businesses.js';
import { getOrCreateWebsite } from '../db/websites.js';
import { createCrawlJob } from '../db/crawlJobs.js';
import { getDatasetById } from '../db/datasets.js';

const GREECE_COUNTRY_CODE = 'GR';

export interface DiscoveryResult {
  businessesFound: number;
  businessesCreated: number;
  businessesSkipped: number;
  businessesUpdated: number;
  websitesCreated: number;
  errors: string[];
}

export async function discoverBusinesses(input: DiscoveryInput): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    businessesFound: 0,
    businessesCreated: 0,
    businessesSkipped: 0,
    businessesUpdated: 0,
    websitesCreated: 0,
    errors: []
  };

  try {
    // Validate dataset exists and get user_id
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

    // Get or create industry
    const industry = await getOrCreateIndustry(input.industry);

    let places: any[];
    let resolvedLatitude = input.latitude;
    let resolvedLongitude = input.longitude;
    let resolvedRadiusKm = input.cityRadiusKm;

    // Use geo-grid discovery if enabled
    if (input.useGeoGrid) {
      // Resolve city coordinates if not provided
      if (!resolvedLatitude || !resolvedLongitude || !resolvedRadiusKm) {
        if (!input.city) {
          throw new Error('City name is required for geo-grid discovery when coordinates are not provided');
        }

        console.log(`\n🔍 Resolving coordinates for city: ${input.city}`);

        // Check if city exists in database with coordinates
        // Use the same normalization as the database
        const { normalizeCityName } = await import('../utils/cityNormalizer.js');
        const normalizedCityName = normalizeCityName(input.city);
        const existingCity = await getCityByNormalizedName(normalizedCityName);
        
        if (existingCity?.latitude && existingCity?.longitude && existingCity?.radius_km) {
          console.log(`✓ Found coordinates in database: ${existingCity.latitude}, ${existingCity.longitude} (radius: ${existingCity.radius_km}km)`);
          resolvedLatitude = existingCity.latitude;
          resolvedLongitude = existingCity.longitude;
          resolvedRadiusKm = existingCity.radius_km;
        } else {
          // Fetch coordinates from Google Places API
          console.log(`  Fetching coordinates from Google Places API...`);
          const coordinates = await googleMapsService.getCityCoordinates(input.city);
          
          if (!coordinates) {
            throw new Error(`Could not resolve coordinates for city: ${input.city}`);
          }

          resolvedLatitude = coordinates.lat;
          resolvedLongitude = coordinates.lng;
          resolvedRadiusKm = coordinates.radiusKm;

          // Store coordinates in database
          if (existingCity) {
            await updateCityCoordinates(existingCity.id, coordinates);
            console.log(`✓ Updated city coordinates in database`);
          } else {
            // City will be created later in processPlace, but we can pre-create it with coordinates
            await getOrCreateCity(input.city, country.id, coordinates);
            console.log(`✓ Created city record with coordinates`);
          }
        }
      }

      if (!resolvedLatitude || !resolvedLongitude || !resolvedRadiusKm) {
        throw new Error('City coordinates could not be resolved');
      }
      console.log('🌐 Using geo-grid discovery mode');
      
      const geoGridResult = await geoGridDiscoveryService.discoverBusinessesByCity({
        industry: input.industry,
        city: {
          name: input.city || 'Unknown',
          lat: resolvedLatitude!,
          lng: resolvedLongitude!,
          radiusKm: resolvedRadiusKm!
        }
      });

      places = geoGridResult.results;
      result.businessesFound = geoGridResult.stats.uniquePlaceIds;
      
      console.log(`\n📊 Geo-grid stats:`);
      console.log(`   Grid points: ${geoGridResult.stats.gridPointsGenerated}`);
      console.log(`   API calls: ${geoGridResult.stats.apiCallsMade}`);
      console.log(`   Unique businesses: ${geoGridResult.stats.uniquePlaceIds}`);
    } else {
      // Use simple text search (original behavior)
      console.log('🔍 Using simple text search mode');
      
      // Build search query
      let searchQuery = `${input.industry}`;
      if (input.city) {
        searchQuery += ` ${input.city}`;
      }
      searchQuery += ' Greece';

      // Search Google Maps
      const location = input.latitude && input.longitude 
        ? { lat: input.latitude, lng: input.longitude }
        : undefined;

      places = await googleMapsService.searchPlaces(searchQuery, location);
      result.businessesFound = places.length;
    }

    // Process each place
    console.log(`\n💾 Persisting ${places.length} businesses to database...`);
    console.log(`   Dataset ID: ${dataset.id}`);
    console.log(`   Owner User ID: ${dataset.user_id}`);
    
    for (const place of places) {
      try {
        await processPlace(place, country.id, industry.id, dataset.id, dataset.user_id, result);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Error processing place ${place.place_id}: ${errorMsg}`);
        console.error(`Error processing place ${place.place_id}:`, error);
      }
    }

    // Log persistence summary
    console.log(`\n📊 Persistence Summary:`);
    console.log(`   Total places fetched: ${result.businessesFound}`);
    console.log(`   Businesses inserted: ${result.businessesCreated}`);
    console.log(`   Businesses skipped (duplicates): ${result.businessesSkipped}`);
    console.log(`   Businesses updated: ${result.businessesUpdated}`);
    console.log(`   Websites created: ${result.websitesCreated}`);
    if (result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.length}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Discovery error: ${errorMsg}`);
    console.error('Discovery error:', error);
  }

  return result;
}

async function processPlace(
  place: any,
  countryId: number,
  industryId: number,
  datasetId: string, // UUID
  ownerUserId: string,
  result: DiscoveryResult
): Promise<void> {
  // Validate place_id exists
  if (!place.place_id) {
    throw new Error('Place ID is required');
  }

  // Extract city and postal code from address components
  let cityName: string | null = null;
  let postalCode: string | null = null;

  if (place.address_components) {
    for (const component of place.address_components) {
      // Prioritize 'locality' type for city
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

  // If no city found in components, try to extract from formatted address
  if (!cityName && place.formatted_address) {
    // Simple extraction - you may want to improve this
    const addressParts = place.formatted_address.split(',');
    if (addressParts.length > 0) {
      cityName = addressParts[addressParts.length - 2]?.trim() || null;
    }
  }

  if (!cityName) {
    throw new Error('Could not extract city from place data');
  }

  // Get or create city
  const city = await getOrCreateCity(cityName, countryId);

  // Upsert business: Insert if new, Update if exists
  // This ensures fresh data from Google Places API
  const { business, wasUpdated } = await upsertBusiness({
    name: place.name,
    address: place.formatted_address || null,
    postal_code: postalCode,
    city_id: city.id,
    industry_id: industryId,
    google_place_id: place.place_id,
    dataset_id: datasetId,
    owner_user_id: ownerUserId
  });

  if (wasUpdated) {
    // Business was updated (existing record refreshed)
    result.businessesUpdated++;
  } else {
    // Business was inserted (new record)
    result.businessesCreated++;
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
      console.error(`Error creating website for business ${business.id}:`, error);
    }
  }
}
