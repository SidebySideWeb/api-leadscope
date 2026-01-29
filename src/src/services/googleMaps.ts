import axios from 'axios';
import type { GooglePlaceResult } from '../types/index.js';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_MAPS_API_KEY) {
  throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
}

export interface CityCoordinates {
  lat: number;
  lng: number;
  radiusKm: number;
}

export interface GoogleMapsProvider {
  searchPlaces(query: string, location?: { lat: number; lng: number }): Promise<GooglePlaceResult[]>;
  getPlaceDetails(placeId: string): Promise<GooglePlaceResult | null>;
  getCityCoordinates(cityName: string): Promise<CityCoordinates | null>;
}

class GoogleMapsPlacesService implements GoogleMapsProvider {
  private apiKey: string;
  private baseUrl = 'https://places.googleapis.com/v1';

  // Field mask for place details - includes all fields we need
  private readonly placeDetailsFieldMask = 'id,displayName,formattedAddress,websiteUri,nationalPhoneNumber,addressComponents,rating,userRatingCount';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async searchPlaces(query: string, location?: { lat: number; lng: number }): Promise<GooglePlaceResult[]> {
    try {
      const url = `${this.baseUrl}/places:searchText`;
      
      const requestBody: any = {
        textQuery: query,
        languageCode: 'el',
        regionCode: 'GR'
      };

      // Add location bias if provided
      if (location) {
        requestBody.locationBias = {
          circle: {
            center: {
              latitude: location.lat,
              longitude: location.lng
            },
            radius: 50000.0 // 50km in meters
          }
        };
      }

      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents'
        }
      });

      if (!response.data.places || response.data.places.length === 0) {
        return [];
      }

      // Get detailed information for each place
      const detailedResults: GooglePlaceResult[] = [];
      for (const place of response.data.places) {
        const details = await this.getPlaceDetails(place.id);
        if (details) {
          detailedResults.push(details);
        }
        // Rate limiting: small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      return detailedResults;
    } catch (error: any) {
      console.error('Error searching Google Maps:', error.response?.data || error.message);
      throw error;
    }
  }

  async getPlaceDetails(placeId: string): Promise<GooglePlaceResult | null> {
    try {
      const url = `${this.baseUrl}/places/${placeId}`;
      
      const response = await axios.get(url, {
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': this.placeDetailsFieldMask
        },
        params: {
          languageCode: 'el'
        }
      });

      if (!response.data) {
        console.warn(`Failed to get place details for ${placeId}: No data returned`);
        return null;
      }

      const place = response.data;

      // Map new API response format to our GooglePlaceResult format
      return {
        place_id: place.id,
        name: place.displayName?.text || '',
        formatted_address: place.formattedAddress || '',
        website: place.websiteUri || undefined,
        international_phone_number: place.nationalPhoneNumber || undefined,
        address_components: this.mapAddressComponents(place.addressComponents),
        rating: place.rating || undefined,
        user_rating_count: place.userRatingCount || undefined
      };
    } catch (error: any) {
      console.error(`Error getting place details for ${placeId}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get city coordinates by searching for the city name
   * Restricts results to locality and administrative areas
   */
  async getCityCoordinates(cityName: string): Promise<CityCoordinates | null> {
    try {
      const query = `${cityName} Greece`;
      const url = `${this.baseUrl}/places:searchText`;

      const requestBody: any = {
        textQuery: query,
        languageCode: 'el',
        regionCode: 'GR'
      };

      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents'
        }
      });

      if (!response.data.places || response.data.places.length === 0) {
        console.warn(`No results found for city: ${cityName}`);
        return null;
      }

      // Filter results to only include cities/localities
      const cityPlaces = response.data.places.filter((place: any) => {
        const types = place.types || [];
        return (
          types.includes('locality') ||
          types.includes('administrative_area_level_3') ||
          types.includes('administrative_area_level_2')
        );
      });

      if (cityPlaces.length === 0) {
        console.warn(`No city results found for: ${cityName}`);
        return null;
      }

      // Use the first matching result
      const cityPlace = cityPlaces[0];

      if (!cityPlace.location) {
        console.warn(`No location data for city: ${cityName}`);
        return null;
      }

      const lat = cityPlace.location.latitude;
      const lng = cityPlace.location.longitude;

      // Estimate radius based on city type
      // Larger administrative areas get larger radius
      let radiusKm = 10; // Default radius
      const types = cityPlace.types || [];
      if (types.includes('administrative_area_level_2')) {
        radiusKm = 20; // Regional unit - larger area
      } else if (types.includes('administrative_area_level_3')) {
        radiusKm = 15; // Municipality - medium area
      } else if (types.includes('locality')) {
        radiusKm = 12; // City/town - smaller area
      }

      console.log(`✓ Resolved coordinates for ${cityName}: ${lat}, ${lng} (radius: ${radiusKm}km)`);

      return {
        lat,
        lng,
        radiusKm
      };
    } catch (error: any) {
      console.error(`Error resolving city coordinates for ${cityName}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Maps new API address components format to old format for compatibility
   */
  private mapAddressComponents(components?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
    languageCode?: string;
  }>): Array<{
    types: string[];
    long_name: string;
    short_name: string;
  }> | undefined {
    if (!components) {
      return undefined;
    }

    return components.map(component => ({
      types: component.types || [],
      long_name: component.longText || '',
      short_name: component.shortText || ''
    }));
  }
}

export const googleMapsService: GoogleMapsProvider = new GoogleMapsPlacesService(GOOGLE_MAPS_API_KEY);
