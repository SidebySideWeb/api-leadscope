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
  searchPlaces(query: string, location?: { lat: number; lng: number }, radiusMeters?: number): Promise<GooglePlaceResult[]>;
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

  async searchPlaces(query: string, location?: { lat: number; lng: number }, radiusMeters?: number): Promise<GooglePlaceResult[]> {
    try {
      const url = `${this.baseUrl}/places:searchText`;
      
      const requestBody: any = {
        textQuery: query,
        languageCode: 'el',
        regionCode: 'GR'
      };

      // Add location bias if provided
      if (location) {
        // Use provided radius or default to 1.5km (1500m) for grid-based discovery
        const searchRadius = radiusMeters || 1500;
        requestBody.locationBias = {
          circle: {
            center: {
              latitude: location.lat,
              longitude: location.lng
            },
            radius: searchRadius
          }
        };
      }

      // DEBUG: Log request details
      console.log('[GoogleMaps] Search request:', {
        query,
        location: location ? { lat: location.lat, lng: location.lng, radiusMeters: radiusMeters || 1500 } : 'none',
        url,
        requestBody: JSON.stringify(requestBody, null, 2)
      });

      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          // CRITICAL: Discovery phase only - no Place Details fields (website, phone)
          // Only fetch: id, name, address, location, rating, types, addressComponents
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.addressComponents'
        }
      });

      // CRITICAL DEBUG: Log raw Google response structure
      console.log('[GoogleMaps] ===== RAW GOOGLE RESPONSE =====');
      console.log('[GoogleMaps] Response status:', response.status);
      console.log('[GoogleMaps] Response headers:', response.headers);
      console.log('[GoogleMaps] Has response.data:', !!response.data);
      console.log('[GoogleMaps] response.data type:', typeof response.data);
      console.log('[GoogleMaps] response.data keys:', response.data ? Object.keys(response.data) : 'no data');
      
      // Try multiple possible response structures
      const placesArray = response.data?.places ?? response.data?.results ?? [];
      const rawPlaces = Array.isArray(placesArray) ? placesArray : [];
      
      console.log('[GoogleMaps] RAW GOOGLE PLACES:', rawPlaces.length);
      console.log('[GoogleMaps] Full response.data:', JSON.stringify(response.data, null, 2));
      console.log('[GoogleMaps] Response structure check:', {
        status: response.status,
        hasData: !!response.data,
        hasPlaces: !!response.data?.places,
        hasResults: !!response.data?.results,
        placesType: Array.isArray(response.data?.places) ? 'array' : typeof response.data?.places,
        resultsType: Array.isArray(response.data?.results) ? 'array' : typeof response.data?.results,
        placesCount: rawPlaces.length,
        samplePlace: rawPlaces.length > 0 ? {
          id: rawPlaces[0]?.id,
          idType: typeof rawPlaces[0]?.id,
          displayName: rawPlaces[0]?.displayName,
          displayNameType: typeof rawPlaces[0]?.displayName,
          displayNameValue: rawPlaces[0]?.displayName,
          hasLocation: !!rawPlaces[0]?.location,
          location: rawPlaces[0]?.location,
          fullPlace: JSON.stringify(rawPlaces[0], null, 2)
        } : null
      });
      console.log('[GoogleMaps] ===============================');

      // CRITICAL: Check for places in multiple possible locations
      if (!response.data) {
        console.error('[GoogleMaps] ERROR: No response.data at all!');
        return [];
      }

      // Try both places and results arrays
      const places = response.data.places ?? response.data.results ?? [];
      if (!Array.isArray(places) || places.length === 0) {
        console.warn('[GoogleMaps] No places found for query:', query);
        console.warn('[GoogleMaps] Places array:', places);
        console.warn('[GoogleMaps] Response data keys:', Object.keys(response.data));
        console.warn('[GoogleMaps] Response data:', JSON.stringify(response.data, null, 2).substring(0, 2000));
        return [];
      }
      
      console.log('[GoogleMaps] Found', places.length, 'places in response');

      // CRITICAL: Discovery phase MUST NOT call Place Details API
      // Return only data from Text Search API (no Place Details calls)
      // Place Details will be fetched later in extraction phase if needed
      const results: GooglePlaceResult[] = [];
      console.log('[GoogleMaps] Processing', places.length, 'places from response');
      for (const place of places) {
        // CRITICAL: Google Places API (New) returns:
        // - id: "places/ChIJ..." (may include "places/" prefix) OR just "ChIJ..."
        // - displayName: { text: "Business Name" } (object with text property)
        // Extract place ID - strip "places/" prefix if present
        const rawId = place.id;
        let googlePlaceId: string;
        
        // DEBUG: Log raw place structure
        if (results.length < 3) {
          console.log('[GoogleMaps] Processing place:', {
            rawId,
            rawIdType: typeof rawId,
            rawIdValue: rawId,
            displayName: place.displayName,
            displayNameType: typeof place.displayName,
            hasFormattedAddress: !!place.formattedAddress,
            fullPlaceKeys: Object.keys(place)
          });
        }
        
        if (!rawId) {
          // CRITICAL: Generate a fallback ID instead of empty string
          // Empty strings cause places to be skipped in discovery worker
          const fallbackId = `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          console.warn('[GoogleMaps] Place missing id field - using fallback ID:', {
            fallbackId,
            displayName: place.displayName,
            formattedAddress: place.formattedAddress,
            fullPlace: JSON.stringify(place, null, 2)
          });
          googlePlaceId = fallbackId;
        } else if (typeof rawId === 'string' && rawId.startsWith('places/')) {
          googlePlaceId = rawId.replace(/^places\//, '');
        } else {
          googlePlaceId = String(rawId);
        }

        // Extract display name - must use .text property
        const displayName = place.displayName?.text ?? (typeof place.displayName === 'string' ? place.displayName : 'Unknown');
        
        // CRITICAL: If we still don't have a name, use formatted address or generate one
        const finalName = displayName || place.formattedAddress || `Unnamed Place ${results.length + 1}`;

        // Safe mapping baseline - ensure all places are mapped even with missing optional fields
        // CRITICAL: Never use empty string for place_id - it causes places to be skipped
        const mappedPlace: GooglePlaceResult = {
          place_id: googlePlaceId, // Already guaranteed to be non-empty (fallback ID if needed)
          name: finalName,
          formatted_address: place.formattedAddress || '',
          // website and phone are NOT available from Text Search - will be fetched in extraction if needed
          website: undefined,
          international_phone_number: undefined,
          address_components: this.mapAddressComponents(place.addressComponents),
          // rating and user_rating_count may be available from Text Search
          rating: place.rating || undefined,
          user_rating_count: place.userRatingCount || undefined,
          // Location is available from Text Search API
          latitude: place.location?.latitude || undefined,
          longitude: place.location?.longitude || undefined
        };

        // DEBUG: Log mapping details for first few places
        if (results.length < 3) {
          console.log('[GoogleMaps] Mapped place:', {
            rawId,
            googlePlaceId,
            finalName,
            hasLocation: !!place.location,
            latitude: place.location?.latitude,
            longitude: place.location?.longitude,
            mappedPlace: JSON.stringify(mappedPlace, null, 2)
          });
        }

        results.push(mappedPlace);
      }

      console.log('[GoogleMaps] ===== MAPPING COMPLETE =====');
      console.log('[GoogleMaps] Mapped results count:', results.length);
      console.log('[GoogleMaps] Sample mapped results:', results.slice(0, 3).map(r => ({
        place_id: r.place_id,
        name: r.name,
        hasLocation: !!(r.latitude && r.longitude)
      })));
      console.log('[GoogleMaps] ===============================');
      
      if (results.length === 0) {
        console.error('[GoogleMaps] CRITICAL: Mapped 0 results but had', places.length, 'places in response!');
        console.error('[GoogleMaps] This means places are being dropped during mapping!');
      }
      
      return results;
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

      // CRITICAL: Handle Google Places API (New) ID format
      // ID may be "places/ChIJ..." - strip prefix if present
      const rawId = place.id;
      let googlePlaceId: string;
      if (!rawId) {
        console.warn('[GoogleMaps] Place Details missing id field');
        googlePlaceId = '';
      } else if (typeof rawId === 'string' && rawId.startsWith('places/')) {
        googlePlaceId = rawId.replace(/^places\//, '');
      } else {
        googlePlaceId = String(rawId);
      }

      // Map new API response format to our GooglePlaceResult format
      return {
        place_id: googlePlaceId,
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
