import { haversineDistance } from './haversine.js';

export interface GridPoint {
  lat: number;
  lng: number;
}

/**
 * Generate a grid of geographic points covering a circular area
 * 
 * @param centerLat Center latitude in degrees
 * @param centerLng Center longitude in degrees
 * @param radiusKm Radius of the area to cover in kilometers
 * @param stepKm Grid step size in kilometers (default: 1.5)
 * @returns Array of grid points
 */
export function generateGridPoints(
  centerLat: number,
  centerLng: number,
  radiusKm: number,
  stepKm: number = 1.5
): GridPoint[] {
  const points: GridPoint[] = [];
  
  // Calculate bounding box
  // Approximate: 1 degree latitude ≈ 111 km
  // Longitude varies by latitude: 1 degree ≈ 111 km * cos(latitude)
  const latStep = stepKm / 111;
  const lngStep = stepKm / (111 * Math.cos(toRadians(centerLat)));

  // Calculate grid bounds
  const latRange = radiusKm / 111;
  const lngRange = radiusKm / (111 * Math.cos(toRadians(centerLat)));

  const minLat = centerLat - latRange;
  const maxLat = centerLat + latRange;
  const minLng = centerLng - lngRange;
  const maxLng = centerLng + lngRange;

  // Generate grid points
  for (let lat = minLat; lat <= maxLat; lat += latStep) {
    for (let lng = minLng; lng <= maxLng; lng += lngStep) {
      // Check if point is within radius
      const distance = haversineDistance(centerLat, centerLng, lat, lng);
      if (distance <= radiusKm) {
        points.push({ lat, lng });
      }
    }
  }

  return points;
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate the number of grid points that will be generated
 * (useful for logging/planning)
 */
export function estimateGridPointCount(
  radiusKm: number,
  stepKm: number = 1.5
): number {
  // Approximate calculation
  const diameter = radiusKm * 2;
  const pointsPerDimension = Math.ceil(diameter / stepKm);
  return Math.ceil(Math.PI * Math.pow(pointsPerDimension / 2, 2));
}
