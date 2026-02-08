/**
 * Vrisko.gr Service
 * Primary source for business discovery and contact extraction
 * Replaces Google Places API for contact details
 */

import { VriskoCrawler, type VriskoBusiness } from '../crawler/vrisko/vriskoCrawler.js';
import type { GooglePlaceResult } from '../types/index.js';
import { Logger } from '../crawler/vrisko/utils/logger.js';

export interface VriskoSearchResult {
  businesses: GooglePlaceResult[];
  source: 'vrisko';
  totalFound: number;
  vriskoData?: Map<string, VriskoBusiness>; // Map business name to vrisko data for contact extraction
}

export class VriskoService {
  private crawler: VriskoCrawler;
  private logger: Logger;

  constructor() {
    this.crawler = new VriskoCrawler({
      maxPages: 50, // Reasonable limit for discovery
      concurrency: 1, // Sequential to avoid blocking
      delayBetweenPages: true,
    });
    this.logger = new Logger('VriskoService');
  }

  /**
   * Converts vrisko business to GooglePlaceResult format for compatibility
   * Note: We store vrisko-specific data (phones, email) separately since GooglePlaceResult
   * doesn't support arrays or custom fields
   */
  private convertToGooglePlaceResult(vrisko: VriskoBusiness): GooglePlaceResult & { _vrisko_id?: string } {
    // Build formatted address
    const addressParts: string[] = [];
    if (vrisko.address.street) addressParts.push(vrisko.address.street);
    if (vrisko.address.city) addressParts.push(vrisko.address.city);
    if (vrisko.address.postal_code) addressParts.push(vrisko.address.postal_code);
    const formattedAddress = addressParts.join(', ') || '';

    // Map address components
    const addressComponents = [];
    if (vrisko.address.street) {
      addressComponents.push({
        long_name: vrisko.address.street,
        short_name: vrisko.address.street,
        types: ['street_address'],
      });
    }
    if (vrisko.address.city) {
      addressComponents.push({
        long_name: vrisko.address.city,
        short_name: vrisko.address.city,
        types: ['locality'],
      });
    }
    if (vrisko.address.postal_code) {
      addressComponents.push({
        long_name: vrisko.address.postal_code,
        short_name: vrisko.address.postal_code,
        types: ['postal_code'],
      });
    }
    if (vrisko.address.region) {
      addressComponents.push({
        long_name: vrisko.address.region,
        short_name: vrisko.address.region,
        types: ['administrative_area_level_1'],
      });
    }
    if (vrisko.address.country) {
      addressComponents.push({
        long_name: vrisko.address.country,
        short_name: vrisko.address.country,
        types: ['country'],
      });
    }

    return {
      place_id: '', // Vrisko doesn't have Google Place ID
      name: vrisko.name,
      formatted_address: formattedAddress,
      website: vrisko.website || undefined,
      international_phone_number: vrisko.phones[0] || undefined, // First phone as primary
      address_components: addressComponents,
      rating: undefined,
      user_rating_count: undefined,
      latitude: vrisko.location.latitude || undefined,
      longitude: vrisko.location.longitude || undefined,
      // Store vrisko ID for later contact extraction
      _vrisko_id: vrisko.id,
    };
  }

  /**
   * Searches vrisko.gr for businesses by keyword and location
   * This is the PRIMARY discovery method
   */
  async searchBusinesses(
    keyword: string,
    location: string,
    maxPages?: number
  ): Promise<VriskoSearchResult> {
    try {
      this.logger.info(`Searching vrisko.gr for "${keyword}" in "${location}"`);

      const vriskoResults = await this.crawler.crawl(keyword, location, maxPages);

      this.logger.success(`Found ${vriskoResults.length} businesses from vrisko.gr`);

      // Convert to GooglePlaceResult format for compatibility
      const businesses = vriskoResults
        .map((v) => this.convertToGooglePlaceResult(v))
        .filter((b) => b.name); // Filter out invalid results

      // Store vrisko data map for contact extraction
      const vriskoDataMap = new Map<string, VriskoBusiness>();
      vriskoResults.forEach((v) => {
        vriskoDataMap.set(v.name.toLowerCase().trim(), v);
      });

      return {
        businesses,
        source: 'vrisko',
        totalFound: businesses.length,
        vriskoData: vriskoDataMap,
      };
    } catch (error: any) {
      this.logger.error(`Vrisko search failed:`, error);
      // Return empty result instead of throwing - allows fallback to Google Places
      return {
        businesses: [],
        source: 'vrisko',
        totalFound: 0,
      };
    }
  }

  /**
   * Extracts contact details from vrisko business data
   * This replaces Place Details API calls for contacts
   */
  extractContacts(vriskoBusiness: VriskoBusiness): {
    phones: string[];
    email: string | null;
    website: string | null;
  } {
    return {
      phones: vriskoBusiness.phones || [],
      email: vriskoBusiness.email,
      website: vriskoBusiness.website,
    };
  }
}

export const vriskoService = new VriskoService();
