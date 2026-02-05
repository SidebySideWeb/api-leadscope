import { pool } from '../src/config/database.js';
import { getIndustryById } from '../src/db/industries.js';
import { getCityById } from '../src/db/cities.js';
import { generateGridPoints } from '../src/utils/geo.js';
import { getDiscoveryConfig } from '../src/config/discoveryConfig.js';

const INDUSTRY_ID = '1e539953-2b2a-44fe-a7e6-78a2b98cab4c'; // Barbers
const CITY_ID = 'f7173014-48eb-488e-a8e7-46d4f8c83ef5'; // Athens

async function diagnoseDiscovery() {
  try {
    console.log('🔍 Diagnosing Discovery Configuration\n');
    console.log('='.repeat(80));

    // Check industry
    const industry = await getIndustryById(INDUSTRY_ID);
    if (!industry) {
      console.error('❌ Industry not found');
      return;
    }

    console.log('\n📋 Industry:');
    console.log(`  ID: ${industry.id}`);
    console.log(`  Name: ${industry.name}`);
    console.log(`  Discovery Keywords: ${industry.discovery_keywords?.join(', ') || 'NONE'}`);

    if (!industry.discovery_keywords || industry.discovery_keywords.length === 0) {
      console.error('\n❌ Industry has NO discovery keywords!');
      console.error('   This will cause discovery to find 0 businesses.');
      return;
    }

    // Check city
    const city = await getCityById(CITY_ID);
    if (!city) {
      console.error('❌ City not found');
      return;
    }

    console.log('\n📍 City:');
    console.log(`  ID: ${city.id}`);
    console.log(`  Name: ${city.name}`);
    console.log(`  Latitude: ${city.latitude}`);
    console.log(`  Longitude: ${city.longitude}`);
    console.log(`  Radius (km): ${city.radius_km}`);

    if (!city.latitude || !city.longitude || !city.radius_km) {
      console.error('\n❌ City missing coordinates or radius!');
      return;
    }

    // Check grid generation
    const config = getDiscoveryConfig();
    console.log('\n⚙️  Discovery Config:');
    console.log(`  Grid Radius: ${config.gridRadiusKm}km`);
    console.log(`  Grid Density: ${config.gridDensity}km`);
    console.log(`  Max Searches: ${config.maxSearchesPerDataset}`);
    console.log(`  Concurrency: ${config.concurrency}`);

    const gridPoints = generateGridPoints(
      city.latitude!,
      city.longitude!,
      city.radius_km!,
      config.gridDensity
    );

    console.log(`\n🗺️  Grid Points Generated: ${gridPoints.length}`);

    if (gridPoints.length === 0) {
      console.error('\n❌ Grid generated 0 points!');
      console.error('   This will cause discovery to find 0 businesses.');
      return;
    }

    // Calculate search tasks
    const searchTasks = gridPoints.length * industry.discovery_keywords.length;
    const limitedSearchTasks = Math.min(searchTasks, config.maxSearchesPerDataset);

    console.log(`\n🔍 Search Tasks:`);
    console.log(`  Total possible: ${searchTasks} (${gridPoints.length} points × ${industry.discovery_keywords.length} keywords)`);
    console.log(`  Limited to: ${limitedSearchTasks}`);

    // Show sample queries
    console.log(`\n📝 Sample Search Queries:`);
    const sampleQueries = industry.discovery_keywords.slice(0, 3).map(keyword => 
      `${keyword} ${city.name}`
    );
    sampleQueries.forEach((query, i) => {
      console.log(`  ${i + 1}. "${query}"`);
    });

    console.log('\n✅ Configuration looks correct!');
    console.log('\nIf discovery still finds 0 businesses, check PM2 logs:');
    console.log('  pm2 logs leadscope-api --lines 500 | grep discoverBusinessesV2');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

diagnoseDiscovery();
