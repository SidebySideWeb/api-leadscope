import dotenv from 'dotenv';
import { testConnection } from '../config/database.js';
import { discoveryQueue } from '../queues/index.js';
import { discoverBusinesses } from '../workers/discoveryWorker.js';
import type { DiscoveryInput } from '../types/index.js';

dotenv.config();

async function main() {
  // Test database connection
  const connected = await testConnection();
  if (!connected) {
    console.error('Failed to connect to database. Exiting.');
    process.exit(1);
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.error('Usage: npm run discover <industry> <city> <datasetId> [latitude] [longitude] [radiusKm] [--geo-grid]');
    console.error('Example: npm run discover "restaurant" "Athens" "550e8400-e29b-41d4-a716-446655440000"');
    console.error('Example: npm run discover "restaurant" "" "550e8400-e29b-41d4-a716-446655440000" 37.9838 23.7275');
    console.error('Example: npm run discover "restaurant" "Athens" "550e8400-e29b-41d4-a716-446655440000" 37.9838 23.7275 15 --geo-grid');
    console.error('Example: npm run discover "restaurant" "Athens" "550e8400-e29b-41d4-a716-446655440000" --geo-grid  (auto-resolves coordinates)');
    console.error('');
    console.error('Note: datasetId is required to ensure proper ownership and prevent cross-user contamination');
    process.exit(1);
  }

  const industry = args[0];
  const city = args[1] || undefined;
  const datasetId = args[2];

  const latitude = args[3] ? parseFloat(args[3]) : undefined;
  const longitude = args[4] ? parseFloat(args[4]) : undefined;
  const radiusKm = args[5] ? parseFloat(args[5]) : undefined;
  const useGeoGrid = args.includes('--geo-grid');

  // Validate UUID format
  if (!datasetId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(datasetId)) {
    console.error('Error: datasetId must be a valid UUID');
    console.error('Example UUID format: 550e8400-e29b-41d4-a716-446655440000');
    process.exit(1);
  }

  // Geo-grid can work with just city name (coordinates will be auto-resolved)
  // Or with explicit coordinates
  if (useGeoGrid && !city && (!latitude || !longitude || !radiusKm)) {
    console.error('Error: --geo-grid requires either city name or explicit coordinates');
    console.error('Example: npm run discover "restaurant" "Athens" "550e8400-e29b-41d4-a716-446655440000" --geo-grid');
    console.error('Example: npm run discover "restaurant" "Athens" "550e8400-e29b-41d4-a716-446655440000" 37.9838 23.7275 15 --geo-grid');
    process.exit(1);
  }

  const input: DiscoveryInput = {
    industry,
    city,
    latitude,
    longitude,
    useGeoGrid,
    cityRadiusKm: radiusKm,
    datasetId
  };

  console.log('Starting business discovery...');
  console.log('Input:', JSON.stringify(input, null, 2));

  try {
    await discoveryQueue.add(
      {
        id: `discover-${Date.now()}`,
        data: input
      },
      async (data) => {
        const result = await discoverBusinesses(data);
        console.log('\n✅ Discovery completed:');
        console.log(`  Businesses found: ${result.businessesFound}`);
        console.log(`  Businesses inserted: ${result.businessesCreated}`);
        console.log(`  Businesses skipped (duplicates): ${result.businessesSkipped}`);
        console.log(`  Businesses updated: ${result.businessesUpdated}`);
        console.log(`  Websites created: ${result.websitesCreated}`);
        if (result.errors.length > 0) {
          console.log(`  Errors: ${result.errors.length}`);
          result.errors.forEach(err => console.error(`    - ${err}`));
        }
        
        // Verify persistence
        if (result.businessesCreated > 0 || result.businessesUpdated > 0) {
          console.log('\n✓ Businesses successfully persisted to database');
        } else if (result.businessesSkipped > 0) {
          console.log('\n⚠ All businesses were duplicates (already exist in database)');
        }
      }
    );

    await discoveryQueue.onIdle();
    console.log('\nAll discovery tasks completed.');
  } catch (error) {
    console.error('Discovery failed:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
