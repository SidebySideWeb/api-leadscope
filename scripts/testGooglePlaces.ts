/**
 * Standalone Google Places API (New) Test Script
 * 
 * This is a throwaway diagnostic script to test Google Places API independently.
 * It does NOT depend on discovery workers, grid logic, database, or billing.
 * 
 * Usage: tsx scripts/testGooglePlaces.ts
 */

import dotenv from 'dotenv';
dotenv.config();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_MAPS_API_KEY) {
  console.error('❌ ERROR: GOOGLE_MAPS_API_KEY environment variable is required');
  process.exit(1);
}

// Hardcoded test values
const KEYWORD = 'bakery Athens';
const LATITUDE = 37.9838;
const LONGITUDE = 23.7275;
const RADIUS_METERS = 1500;
const REGION_CODE = 'GR';

const API_URL = 'https://places.googleapis.com/v1/places:searchText';

async function testGooglePlacesAPI() {
  console.log('🧪 Testing Google Places API (New)');
  console.log('=====================================');
  console.log(`Keyword: "${KEYWORD}"`);
  console.log(`Location: ${LATITUDE}, ${LONGITUDE}`);
  console.log(`Radius: ${RADIUS_METERS}m`);
  console.log(`Region: ${REGION_CODE}`);
  console.log(`API Key: ${GOOGLE_MAPS_API_KEY.substring(0, 10)}...`);
  console.log('');

  const requestBody = {
    textQuery: KEYWORD,
    locationBias: {
      circle: {
        center: {
          latitude: LATITUDE,
          longitude: LONGITUDE
        },
        radius: RADIUS_METERS
      }
    },
    regionCode: REGION_CODE
  };

  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress'
  };

  console.log('📤 REQUEST:');
  console.log('URL:', API_URL);
  console.log('Headers:', JSON.stringify(headers, null, 2));
  console.log('Body:', JSON.stringify(requestBody, null, 2));
  console.log('');

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    console.log('📥 RESPONSE:');
    console.log('STATUS:', response.status);
    console.log('STATUS TEXT:', response.statusText);
    console.log('');

    const responseText = await response.text();
    console.log('RAW RESPONSE TEXT:');
    console.log(responseText);
    console.log('');

    let data;
    try {
      data = JSON.parse(responseText);
      console.log('PARSED JSON RESPONSE:');
      console.log(JSON.stringify(data, null, 2));
      console.log('');
    } catch (parseError) {
      console.error('❌ Failed to parse JSON response:', parseError);
      console.log('Response was not valid JSON');
      return;
    }

    // Analyze results
    console.log('📊 ANALYSIS:');
    
    if (response.status !== 200) {
      console.log(`❌ HTTP Error: ${response.status}`);
      if (response.status === 403) {
        console.log('   → Likely API key / billing / permission issue');
      } else if (response.status === 400) {
        console.log('   → Likely request format / FieldMask issue');
      } else if (response.status === 404) {
        console.log('   → API endpoint not found');
      }
      return;
    }

    if (!data.places || !Array.isArray(data.places)) {
      console.log('❌ Response missing "places" array');
      console.log('   → Likely FieldMask or API enablement issue');
      return;
    }

    const placesCount = data.places.length;
    console.log(`✅ Found ${placesCount} places`);

    if (placesCount === 0) {
      console.log('⚠️  Zero results - Google API works but returned no places');
      console.log('   → Possible reasons:');
      console.log('      - No bakeries in the specified radius');
      console.log('      - API key restrictions');
      console.log('      - Billing/quota issues');
    } else {
      console.log('✅ Google API works correctly!');
      console.log('');
      console.log('Sample places:');
      data.places.slice(0, 5).forEach((place: any, index: number) => {
        console.log(`  ${index + 1}. ${place.displayName?.text || 'N/A'}`);
        console.log(`     Address: ${place.formattedAddress || 'N/A'}`);
        console.log(`     ID: ${place.id || 'N/A'}`);
      });
    }

  } catch (error) {
    console.error('❌ REQUEST FAILED:');
    console.error(error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
  }
}

// Run the test
testGooglePlacesAPI()
  .then(() => {
    console.log('');
    console.log('✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('');
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
