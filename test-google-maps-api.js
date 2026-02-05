/**
 * Test script to check Google Maps API results for a specific city and industry
 * Usage: node test-google-maps-api.js <city_id> <industry_id>
 */

import dotenv from 'dotenv';
import { pool } from './dist/config/database.js';
import { getCityById } from './dist/db/cities.js';
import { getIndustryById } from './dist/db/industries.js';
import { googleMapsService } from './dist/services/googleMaps.js';

dotenv.config();

async function testGoogleMapsAPI(cityId, industryId) {
  try {
    console.log(`\n🔍 Testing Google Maps API for:`);
    console.log(`   City ID: ${cityId}`);
    console.log(`   Industry ID: ${industryId}\n`);

    // Get city and industry info
    const city = await getCityById(cityId);
    const industry = await getIndustryById(industryId);

    if (!city) {
      console.error(`❌ City not found: ${cityId}`);
      return;
    }
    if (!industry) {
      console.error(`❌ Industry not found: ${industryId}`);
      return;
    }

    console.log(`📍 City: ${city.name}`);
    console.log(`🏢 Industry: ${industry.name}`);
    console.log(`🔑 Industry keywords: ${industry.discovery_keywords || 'N/A'}\n`);

    // Get discovery keywords
    const keywords = industry.discovery_keywords 
      ? industry.discovery_keywords.split(',').map(k => k.trim())
      : [industry.name];

    console.log(`📝 Using keywords: ${keywords.join(', ')}\n`);

    // Test search with first keyword
    const keyword = keywords[0];
    const query = `${keyword} in ${city.name}`;
    
    console.log(`🔎 Searching: "${query}"\n`);

    const results = await googleMapsService.searchPlaces({
      query,
      location: city.latitude && city.longitude 
        ? { lat: city.latitude, lng: city.longitude }
        : undefined,
      radius: city.radius_km ? city.radius_km * 1000 : undefined, // Convert km to meters
    });

    console.log(`✅ Found ${results.length} results\n`);

    if (results.length > 0) {
      console.log(`📋 Sample results (first 10):`);
      results.slice(0, 10).forEach((place, i) => {
        console.log(`\n${i + 1}. ${place.name}`);
        console.log(`   Place ID: ${place.place_id}`);
        console.log(`   Address: ${place.formatted_address || 'N/A'}`);
        console.log(`   Rating: ${place.rating || 'N/A'}`);
        console.log(`   Types: ${place.types?.slice(0, 3).join(', ') || 'N/A'}`);
      });

      if (results.length > 10) {
        console.log(`\n... and ${results.length - 10} more results`);
      }
    } else {
      console.log(`⚠️  No results found. Try different keywords or check city coordinates.`);
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total results: ${results.length}`);
    console.log(`   City: ${city.name} (${city.latitude}, ${city.longitude})`);
    console.log(`   Industry: ${industry.name}`);
    console.log(`   Keywords tested: ${keywords.join(', ')}`);

  } catch (error) {
    console.error(`\n❌ Error:`, error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

// Get command line arguments
const cityId = process.argv[2];
const industryId = process.argv[3];

if (!cityId || !industryId) {
  console.error('Usage: node test-google-maps-api.js <city_id> <industry_id>');
  console.error('\nExample:');
  console.error('  node test-google-maps-api.js f7173014-48eb-488e-a8e7-46d4f8c83ef5 eb263381-7d10-4568-b004-6de659a45df8');
  process.exit(1);
}

testGoogleMapsAPI(cityId, industryId);
