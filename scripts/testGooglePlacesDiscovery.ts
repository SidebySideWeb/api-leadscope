/**
 * Test Google Places API using the EXACT same approach as discovery worker
 * 
 * This tests with:
 * - Just keyword (no city name in query)
 * - Location bias with grid point coordinates
 * - Same FieldMask as discovery worker
 */

import dotenv from 'dotenv';
dotenv.config();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_MAPS_API_KEY) {
  console.error('❌ ERROR: GOOGLE_MAPS_API_KEY environment variable is required');
  process.exit(1);
}

// Simulate discovery worker approach
const KEYWORD = 'bakery'; // Just keyword, no city name
const LATITUDE = 37.9838; // Grid point (Athens center)
const LONGITUDE = 23.7275;
const RADIUS_METERS = 1500; // Same as discovery worker
const REGION_CODE = 'GR';

const API_URL = 'https://places.googleapis.com/v1/places:searchText';

async function testDiscoveryApproach() {
  console.log('🧪 Testing Google Places API (Discovery Worker Approach)');
  console.log('========================================================');
  console.log(`Keyword: "${KEYWORD}" (NO city name - location bias only)`);
  console.log(`Location: ${LATITUDE}, ${LONGITUDE}`);
  console.log(`Radius: ${RADIUS_METERS}m`);
  console.log(`Region: ${REGION_CODE}`);
  console.log('');

  const requestBody = {
    textQuery: KEYWORD, // Just keyword, no city name
    languageCode: 'el',
    regionCode: REGION_CODE,
    locationBias: {
      circle: {
        center: {
          latitude: LATITUDE,
          longitude: LONGITUDE
        },
        radius: RADIUS_METERS
      }
    }
  };

  // Use EXACT same FieldMask as discovery worker
  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.addressComponents'
  };

  console.log('📤 REQUEST (Discovery Worker Format):');
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
      return;
    }

    // Analyze results
    console.log('📊 ANALYSIS:');
    
    if (response.status !== 200) {
      console.log(`❌ HTTP Error: ${response.status}`);
      if (response.status === 403) {
        console.log('   → API key / billing / permission issue');
      } else if (response.status === 400) {
        console.log('   → Request format / FieldMask issue');
        if (data.error) {
          console.log('   → Error details:', JSON.stringify(data.error, null, 2));
        }
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
      console.log('⚠️  ZERO RESULTS - This is the issue!');
      console.log('');
      console.log('🔍 DIAGNOSIS:');
      console.log('   The discovery worker approach returns ZERO results');
      console.log('   while the test script (with city name in query) returns 20 results');
      console.log('');
      console.log('💡 SOLUTION:');
      console.log('   Option 1: Include city name in query: "bakery Athens"');
      console.log('   Option 2: Check if location bias radius is too small');
      console.log('   Option 3: Verify FieldMask fields are all available');
    } else {
      console.log('✅ Discovery worker approach works!');
      console.log('');
      console.log('Sample places:');
      data.places.slice(0, 5).forEach((place: any, index: number) => {
        console.log(`  ${index + 1}. ${place.displayName?.text || 'N/A'}`);
        console.log(`     Address: ${place.formattedAddress || 'N/A'}`);
        console.log(`     ID: ${place.id || 'N/A'}`);
        console.log(`     Location: ${place.location?.latitude || 'N/A'}, ${place.location?.longitude || 'N/A'}`);
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
testDiscoveryApproach()
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
