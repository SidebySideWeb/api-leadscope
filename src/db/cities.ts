import { pool } from '../config/database.js';
import type { City } from '../types/index.js';
import { normalizeCityName } from '../utils/cityNormalizer.js';

export async function getCityByNormalizedName(normalized_name: string): Promise<City | null> {
  const result = await pool.query<City>(
    'SELECT * FROM cities WHERE normalized_name = $1',
    [normalized_name]
  );
  return result.rows[0] || null;
}

export async function createCity(
  name: string,
  country_id: number,
  coordinates?: { lat: number; lng: number; radiusKm: number } | null
): Promise<City> {
  const normalized = normalizeCityName(name);
  const result = await pool.query<City>(
    `INSERT INTO cities (name, normalized_name, country_id, latitude, longitude, radius_km)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      name,
      normalized,
      country_id,
      coordinates?.lat || null,
      coordinates?.lng || null,
      coordinates?.radiusKm || null
    ]
  );
  return result.rows[0];
}

export async function updateCityCoordinates(
  cityId: number,
  coordinates: { lat: number; lng: number; radiusKm: number }
): Promise<City> {
  const result = await pool.query<City>(
    `UPDATE cities 
     SET latitude = $1, longitude = $2, radius_km = $3
     WHERE id = $4
     RETURNING *`,
    [coordinates.lat, coordinates.lng, coordinates.radiusKm, cityId]
  );
  return result.rows[0];
}

export async function getOrCreateCity(
  name: string,
  country_id: number,
  coordinates?: { lat: number; lng: number; radiusKm: number } | null
): Promise<City> {
  const normalized = normalizeCityName(name);
  const existing = await getCityByNormalizedName(normalized);
  if (existing) {
    // Update coordinates if provided and not already set
    if (coordinates && (!existing.latitude || !existing.longitude)) {
      return updateCityCoordinates(existing.id, coordinates);
    }
    return existing;
  }
  return createCity(name, country_id, coordinates);
}
