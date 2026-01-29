/**
 * Example usage of geo-grid discovery
 * 
 * This demonstrates how to use the geo-grid discovery service
 * to discover businesses across an entire city.
 */

import { geoGridDiscoveryService } from '../services/geoGrid.js';
import dotenv from 'dotenv';

dotenv.config();

async function example() {
  console.log('🌐 Geo-Grid Discovery Example\n');

  // Example: Discover restaurants in Athens
  const result = await geoGridDiscoveryService.discoverBusinessesByCity({
    industry: 'restaurant',
    city: {
      name: 'Athens',
      lat: 37.9838,
      lng: 23.7275,
      radiusKm: 15 // 15km radius around Athens center
    },
    gridStepKm: 1.5, // Optional: grid step (default: 1.5km)
    searchRadiusMeters: 1500, // Optional: search radius per point (default: 1500m)
    maxRequestsPerSecond: 5, // Optional: rate limit (default: 5)
    requestDelayMs: 250, // Optional: delay between requests (default: 200-300ms random)
    retryAttempts: 3 // Optional: retry attempts (default: 3)
  });

  console.log('\n📊 Final Results:');
  console.log(`   Total unique businesses: ${result.results.length}`);
  console.log(`   Grid points: ${result.stats.gridPointsGenerated}`);
  console.log(`   API calls: ${result.stats.apiCallsMade}`);
  console.log(`   Duplicates skipped: ${result.stats.duplicatesSkipped}`);

  // Show first few results
  console.log('\n📍 Sample businesses:');
  result.results.slice(0, 5).forEach((place, index) => {
    console.log(`   ${index + 1}. ${place.name}`);
    console.log(`      Address: ${place.formatted_address}`);
    console.log(`      Place ID: ${place.place_id}`);
    if (place.website) {
      console.log(`      Website: ${place.website}`);
    }
    console.log('');
  });
}

// Run example if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  example().catch(console.error);
}
