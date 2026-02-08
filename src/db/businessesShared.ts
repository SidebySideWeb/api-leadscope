/**
 * Shared Business Database Functions
 * 
 * This module handles businesses as global, reusable assets.
 * Businesses are deduplicated globally by google_place_id.
 * Datasets reference businesses via dataset_businesses junction table.
 */

import { pool } from '../config/database.js';
import type { Business } from '../types/index.js';
import { normalizeBusinessName } from '../utils/normalizeBusinessName.js';
import type { GooglePlaceResult } from '../types/index.js';

/**
 * Search businesses in database by industry_id and city_id
 * Returns businesses in GooglePlaceResult format for compatibility
 * This is the PRIMARY discovery method - check DB first before external sources
 */
export async function searchBusinessesInDatabase(
  industryId: string,
  cityId: string,
  limit?: number
): Promise<GooglePlaceResult[]> {
  // Query businesses with aggregated contacts and websites
  const query = `
    SELECT DISTINCT ON (b.id)
      b.id,
      b.name,
      b.normalized_name,
      b.address,
      b.postal_code,
      b.city_id,
      b.industry_id,
      b.google_place_id,
      b.latitude,
      b.longitude,
      b.rating,
      b.user_rating_count,
      (
        SELECT w.url 
        FROM websites w 
        WHERE w.business_id = b.id 
        LIMIT 1
      ) as website,
      (
        SELECT c.phone 
        FROM contact_sources cs
        JOIN contacts c ON c.id = cs.contact_id
        WHERE cs.business_id = b.id::text 
          AND c.contact_type IN ('phone', 'mobile')
          AND c.phone IS NOT NULL
        LIMIT 1
      ) as phone,
      (
        SELECT c.email 
        FROM contact_sources cs
        JOIN contacts c ON c.id = cs.contact_id
        WHERE cs.business_id = b.id::text 
          AND c.contact_type = 'email'
          AND c.email IS NOT NULL
        LIMIT 1
      ) as email
    FROM businesses b
    WHERE b.industry_id = $1
      AND b.city_id = $2
      AND b.is_active = TRUE
    ORDER BY b.id, b.created_at DESC
    ${limit ? `LIMIT ${limit}` : ''}
  `;

  const result = await pool.query(query, [industryId, cityId]);
  
  // Convert to GooglePlaceResult format
  const businesses: GooglePlaceResult[] = [];

  for (const row of result.rows) {
    // Build address components
    const addressComponents: Array<{
      types: string[];
      long_name: string;
      short_name: string;
    }> = [];

    if (row.address) {
      // Try to parse address into components
      const addressParts = row.address.split(',');
      if (addressParts.length > 0) {
        addressComponents.push({
          types: ['street_address'],
          long_name: addressParts[0].trim(),
          short_name: addressParts[0].trim(),
        });
      }
      if (addressParts.length > 1) {
        addressComponents.push({
          types: ['locality'],
          long_name: addressParts[1].trim(),
          short_name: addressParts[1].trim(),
        });
      }
    }

    if (row.postal_code) {
      addressComponents.push({
        types: ['postal_code'],
        long_name: row.postal_code,
        short_name: row.postal_code,
      });
    }

    businesses.push({
      place_id: row.google_place_id || `db_${row.id}`, // Use DB ID if no google_place_id
      name: row.name,
      formatted_address: row.address || '',
      website: row.website || undefined,
      international_phone_number: row.phone || undefined,
      address_components: addressComponents.length > 0 ? addressComponents : undefined,
      rating: row.rating || undefined,
      user_rating_count: row.user_rating_count || undefined,
      latitude: row.latitude || undefined,
      longitude: row.longitude || undefined,
      // Store DB ID and email for reference
      _db_id: row.id,
      _db_email: row.email || undefined,
    } as GooglePlaceResult & { _db_id?: number; _db_email?: string });
  }

  return businesses;
}

/**
 * Get business by Google Place ID (global lookup, not per-dataset)
 */
export async function getBusinessByGooglePlaceIdGlobal(
  google_place_id: string
): Promise<Business | null> {
  const result = await pool.query<Business>(
    'SELECT * FROM businesses WHERE google_place_id = $1 LIMIT 1',
    [google_place_id]
  );
  return result.rows[0] || null;
}
