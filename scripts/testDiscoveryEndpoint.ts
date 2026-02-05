/**
 * Test Discovery Endpoint
 * 
 * This script tests the discovery API endpoint directly to verify it's working
 * and to see logs.
 * 
 * Usage: 
 * 1. Set environment variables: GOOGLE_MAPS_API_KEY, DATABASE_URL
 * 2. Make sure you have a valid JWT token (or modify to use test auth)
 * 3. Run: tsx scripts/testDiscoveryEndpoint.ts
 */

import dotenv from 'dotenv';
dotenv.config();

const API_URL = process.env.API_URL || 'http://localhost:3000';
const DISCOVERY_ENDPOINT = `${API_URL}/discovery/businesses`;

// You'll need to get a valid JWT token - replace this with a real token
// Or modify to use test authentication
const JWT_TOKEN = process.env.TEST_JWT_TOKEN || '';

async function testDiscoveryEndpoint() {
  console.log('🧪 Testing Discovery Endpoint');
  console.log('============================');
  console.log(`API URL: ${API_URL}`);
  console.log(`Endpoint: ${DISCOVERY_ENDPOINT}`);
  console.log('');

  if (!JWT_TOKEN) {
    console.error('❌ ERROR: TEST_JWT_TOKEN environment variable is required');
    console.log('   Get a JWT token from your frontend or auth endpoint');
    process.exit(1);
  }

  // Example request - adjust these IDs to match your database
  const requestBody = {
    industryId: process.env.TEST_INDUSTRY_ID || 'your-industry-id-here',
    cityId: process.env.TEST_CITY_ID || 'your-city-id-here',
    datasetId: process.env.TEST_DATASET_ID || undefined // Optional
  };

  console.log('📤 Request:');
  console.log('Headers:', {
    'Content-Type': 'application/json',
    'Cookie': `token=${JWT_TOKEN}` // Adjust based on your auth method
  });
  console.log('Body:', JSON.stringify(requestBody, null, 2));
  console.log('');

  try {
    const response = await fetch(DISCOVERY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${JWT_TOKEN}` // Adjust based on your auth method
      },
      body: JSON.stringify(requestBody)
    });

    console.log('📥 Response:');
    console.log('Status:', response.status);
    console.log('Status Text:', response.statusText);
    console.log('');

    const responseText = await response.text();
    console.log('Response Body:');
    console.log(responseText);
    console.log('');

    let data;
    try {
      data = JSON.parse(responseText);
      console.log('Parsed JSON:');
      console.log(JSON.stringify(data, null, 2));
    } catch (e) {
      console.log('Response is not JSON');
    }

    if (response.status === 200 || response.status === 201) {
      console.log('✅ Request succeeded!');
      console.log('   Check backend logs for discovery execution');
    } else {
      console.log(`⚠️  Request returned status ${response.status}`);
    }

  } catch (error) {
    console.error('❌ Request failed:');
    console.error(error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
  }
}

testDiscoveryEndpoint()
  .then(() => {
    console.log('');
    console.log('✅ Test completed');
    console.log('');
    console.log('Next steps:');
    console.log('1. Check backend logs for discovery execution');
    console.log('2. Look for logs starting with [API] ===== DISCOVERY API ENDPOINT CALLED =====');
    console.log('3. Check for [runDiscoveryJob] and [discoverBusinessesV2] logs');
    process.exit(0);
  })
  .catch((error) => {
    console.error('');
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
