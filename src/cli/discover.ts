import dotenv from 'dotenv';
import { testConnection } from '../config/database.js';
import { discoverBusinesses } from '../workers/discoveryWorker.js';
import { createDiscoveryRun, updateDiscoveryRun } from '../db/discoveryRuns.js';
import { getDatasetById } from '../db/datasets.js';
import { getIndustryById, getIndustryByName } from '../db/industries.js';
import { getCityById, getCityByNormalizedName } from '../db/cities.js';
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
    console.error('Usage: npm run discover <industry_id|industry_name> <city_id|city_name> <datasetId> [latitude] [longitude] [radiusKm]');
    console.error('');
    console.error('Examples (using IDs - preferred):');
    console.error('  npm run discover <industry-uuid> <city-uuid> <dataset-uuid>');
    console.error('');
    console.error('Examples (using names - legacy):');
    console.error('  npm run discover "restaurant" "Athens" "550e8400-e29b-41d4-a716-446655440000"');
    console.error('  npm run discover "restaurant" "" "550e8400-e29b-41d4-a716-446655440000" 37.9838 23.7275 15');
    console.error('');
    console.error('Note: datasetId is required to ensure proper ownership and prevent cross-user contamination');
    process.exit(1);
  }

  const industryArg = args[0];
  const cityArg = args[1] || undefined;
  const datasetId = args[2];

  const latitude = args[3] ? parseFloat(args[3]) : undefined;
  const longitude = args[4] ? parseFloat(args[4]) : undefined;
  const radiusKm = args[5] ? parseFloat(args[5]) : undefined;

  // Validate UUID format for datasetId
  if (!datasetId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(datasetId)) {
    console.error('Error: datasetId must be a valid UUID');
    console.error('Example UUID format: 550e8400-e29b-41d4-a716-446655440000');
    process.exit(1);
  }

  // Get dataset to extract user_id
  const dataset = await getDatasetById(datasetId);
  if (!dataset) {
    console.error(`Error: Dataset ${datasetId} not found`);
    process.exit(1);
  }

  // Resolve industry: check if it's a UUID or a name
  let industryId: string | undefined;
  let industryName: string | undefined;
  
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(industryArg)) {
    // It's a UUID
    const industry = await getIndustryById(industryArg);
    if (!industry) {
      console.error(`Error: Industry with ID ${industryArg} not found`);
      process.exit(1);
    }
    industryId = industry.id;
    industryName = industry.name;
    console.log(`✓ Using industry: ${industryName} (${industryId})`);
  } else {
    // It's a name (legacy)
    const industry = await getIndustryByName(industryArg);
    if (!industry) {
      console.error(`Error: Industry "${industryArg}" not found. Please use industry_id (UUID) or ensure the industry exists.`);
      process.exit(1);
    }
    industryId = industry.id;
    industryName = industry.name;
    console.log(`✓ Using industry: ${industryName} (${industryId})`);
  }

  // Resolve city: check if it's a UUID or a name
  let cityId: string | undefined;
  let cityName: string | undefined;
  
  if (cityArg && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cityArg)) {
    // It's a UUID
    const city = await getCityById(cityArg);
    if (!city) {
      console.error(`Error: City with ID ${cityArg} not found`);
      process.exit(1);
    }
    cityId = city.id;
    cityName = city.name;
    console.log(`✓ Using city: ${cityName} (${cityId})`);
  } else if (cityArg) {
    // It's a name (legacy)
    const { normalizeCityName } = await import('../utils/cityNormalizer.js');
    const normalizedCityName = normalizeCityName(cityArg);
    const city = await getCityByNormalizedName(normalizedCityName);
    if (!city) {
      console.error(`Error: City "${cityArg}" not found. Please use city_id (UUID) or ensure the city exists.`);
      process.exit(1);
    }
    cityId = city.id;
    cityName = city.name;
    console.log(`✓ Using city: ${cityName} (${cityId})`);
  }

  // Create discovery_run BEFORE starting discovery
  console.log('\n📋 Creating discovery_run...');
  const discoveryRun = await createDiscoveryRun(datasetId, dataset.user_id);
  console.log(`✓ Created discovery_run: ${discoveryRun.id}`);

  // Mark discovery_run as started
  await updateDiscoveryRun(discoveryRun.id, {
    started_at: new Date()
  });
  console.log(`✓ Marked discovery_run as started`);

  // Build discovery input
  const input: DiscoveryInput = {
    industry: industryName, // Legacy support
    industry_id: industryId, // Preferred
    city: cityName, // Legacy support
    city_id: cityId, // Preferred
    latitude,
    longitude,
    useGeoGrid: false, // Use keyword-based discovery (not geo-grid)
    cityRadiusKm: radiusKm,
    datasetId
  };

  console.log('\n🔍 Starting business discovery...');
  console.log('Input:', JSON.stringify(input, null, 2));

  try {
    // Run discovery with discovery_run_id
    const result = await discoverBusinesses(input, discoveryRun.id);
    
    console.log('\n✅ Discovery completed:');
    console.log(`  Businesses found: ${result.businessesFound}`);
    console.log(`  Businesses inserted: ${result.businessesCreated}`);
    console.log(`  Businesses skipped (duplicates): ${result.businessesSkipped}`);
    console.log(`  Businesses updated: ${result.businessesUpdated}`);
    // Note: Websites are created in extraction phase, not discovery
    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
      result.errors.forEach(err => console.error(`    - ${err}`));
    }
    
    // Check if any extraction jobs were created
    const { getExtractionJobsByDiscoveryRunId } = await import('../db/extractionJobs.js');
    const extractionJobs = await getExtractionJobsByDiscoveryRunId(discoveryRun.id);
    
    if (extractionJobs.length === 0) {
      // No extraction jobs created - mark discovery_run as completed
      await updateDiscoveryRun(discoveryRun.id, {
        status: 'completed',
        completed_at: new Date()
      });
      console.log(`\n✓ Marked discovery_run as completed (no extraction jobs created)`);
    } else {
      console.log(`\n✓ Created ${extractionJobs.length} extraction jobs`);
      console.log(`  Discovery_run will be marked as completed when all extraction jobs finish`);
      // Note: Extraction jobs will mark discovery_run as completed when they finish
    }
    
    // Verify persistence
    if (result.businessesCreated > 0 || result.businessesUpdated > 0) {
      console.log('\n✓ Businesses successfully persisted to database');
    } else if (result.businessesSkipped > 0) {
      console.log('\n⚠ All businesses were duplicates (already exist in database)');
    }

    console.log(`\n📊 Discovery Run ID: ${discoveryRun.id}`);
    console.log(`   Status: ${extractionJobs.length > 0 ? 'running' : 'completed'}`);
  } catch (error) {
    // Mark discovery_run as failed on error
    await updateDiscoveryRun(discoveryRun.id, {
      status: 'failed',
      completed_at: new Date(),
      error_message: error instanceof Error ? error.message : String(error)
    });
    console.error('\n❌ Discovery failed:', error);
    console.error(`   Discovery_run ${discoveryRun.id} marked as failed`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
