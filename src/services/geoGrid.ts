import PQueue from 'p-queue';
import type { GooglePlaceResult } from '../types/index.js';
import { googleMapsService } from './googleMaps.js';
import { generateGridPoints, type GridPoint } from '../utils/geo.js';

export interface CityInput {
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

export interface GeoGridDiscoveryOptions {
  industry: string;
  city: CityInput;
  gridStepKm?: number; // Default: 1.5
  searchRadiusMeters?: number; // Default: 1500
  maxRequestsPerSecond?: number; // Default: 5
  requestDelayMs?: number; // Default: 200-300ms random
  retryAttempts?: number; // Default: 3
}

export interface DiscoveryStats {
  gridPointsGenerated: number;
  apiCallsMade: number;
  businessesFound: number;
  uniquePlaceIds: number;
  duplicatesSkipped: number;
  errors: string[];
}

class GeoGridDiscoveryService {
  private readonly defaultGridStep = 1.5; // km
  private readonly defaultSearchRadius = 1500; // meters
  private readonly defaultMaxRequestsPerSecond = 5;
  private readonly defaultRetryAttempts = 3;

  /**
   * Discover businesses in a city using geo-grid approach
   */
  async discoverBusinessesByCity(
    options: GeoGridDiscoveryOptions
  ): Promise<{ results: GooglePlaceResult[]; stats: DiscoveryStats }> {
    const {
      industry,
      city,
      gridStepKm = this.defaultGridStep,
      searchRadiusMeters = this.defaultSearchRadius,
      maxRequestsPerSecond = this.defaultMaxRequestsPerSecond,
      requestDelayMs = this.getRandomDelay(200, 300),
      retryAttempts = this.defaultRetryAttempts
    } = options;

    console.log(`\n🔍 Starting geo-grid discovery for ${city.name}`);
    console.log(`   Industry: ${industry}`);
    console.log(`   Center: ${city.lat}, ${city.lng}`);
    console.log(`   Radius: ${city.radiusKm} km`);
    console.log(`   Grid step: ${gridStepKm} km`);

    // Generate grid points
    const gridPoints = generateGridPoints(
      city.lat,
      city.lng,
      city.radiusKm,
      gridStepKm
    );

    console.log(`\n📍 Generated ${gridPoints.length} grid points`);

    // Statistics
    const stats: DiscoveryStats = {
      gridPointsGenerated: gridPoints.length,
      apiCallsMade: 0,
      businessesFound: 0,
      uniquePlaceIds: 0,
      duplicatesSkipped: 0,
      errors: []
    };

    // Deduplication map: place_id -> GooglePlaceResult
    const uniquePlaces = new Map<string, GooglePlaceResult>();

    // Create queue with rate limiting
    const queue = new PQueue({
      concurrency: 1, // Process one request at a time to respect rate limits
      interval: 1000, // 1 second
      intervalCap: maxRequestsPerSecond // Max requests per interval
    });

    // Process each grid point
    const promises = gridPoints.map((point, index) =>
      queue.add(
        async () => {
          try {
            // Add random delay to avoid hammering the API
            if (index > 0) {
              await this.delay(requestDelayMs);
            }

            console.log(
              `   [${index + 1}/${gridPoints.length}] Searching at ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`
            );

            // Search Google Places API
            const results = await this.searchWithRetry(
              industry,
              point,
              searchRadiusMeters,
              retryAttempts
            );

            stats.apiCallsMade++;
            stats.businessesFound += results.length;

            // Deduplicate by place_id
            for (const place of results) {
              if (uniquePlaces.has(place.place_id)) {
                stats.duplicatesSkipped++;
              } else {
                uniquePlaces.set(place.place_id, place);
              }
            }

            console.log(
              `      ✓ Found ${results.length} businesses (${uniquePlaces.size} unique so far)`
            );
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            stats.errors.push(
              `Grid point ${point.lat}, ${point.lng}: ${errorMsg}`
            );
            console.error(
              `      ✗ Error at ${point.lat}, ${point.lng}: ${errorMsg}`
            );
          }
        },
        { throwOnTimeout: true }
      )
    );

    // Wait for all requests to complete
    await Promise.allSettled(promises);

    // Final statistics
    stats.uniquePlaceIds = uniquePlaces.size;

    console.log(`\n✅ Geo-grid discovery completed:`);
    console.log(`   Grid points: ${stats.gridPointsGenerated}`);
    console.log(`   API calls: ${stats.apiCallsMade}`);
    console.log(`   Total businesses found: ${stats.businessesFound}`);
    console.log(`   Unique place IDs: ${stats.uniquePlaceIds}`);
    console.log(`   Duplicates skipped: ${stats.duplicatesSkipped}`);
    if (stats.errors.length > 0) {
      console.log(`   Errors: ${stats.errors.length}`);
    }

    return {
      results: Array.from(uniquePlaces.values()),
      stats
    };
  }

  /**
   * Search with retry logic
   */
  private async searchWithRetry(
    industry: string,
    location: GridPoint,
    _radiusMeters: number, // Currently not used - Google API uses fixed radius in locationBias
    maxRetries: number
  ): Promise<GooglePlaceResult[]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Build search query - just the industry name
        // Location bias is handled by the location parameter
        const query = industry;

        // Call Google Places API with location bias
        const results = await googleMapsService.searchPlaces(query, {
          lat: location.lat,
          lng: location.lng
        });

        return results;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.warn(
            `      ⚠ Retry ${attempt}/${maxRetries} after ${delay}ms...`
          );
          await this.delay(delay);
        }
      }
    }

    throw lastError || new Error('Search failed after retries');
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get random delay between min and max
   */
  private getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

export const geoGridDiscoveryService = new GeoGridDiscoveryService();
