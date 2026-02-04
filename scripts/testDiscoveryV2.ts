/**
 * Test Discovery V2 Endpoint
 * Tests the discovery API endpoint with V2 worker to see debug logs
 */

import dotenv from 'dotenv';
import { generateToken } from '../src/utils/jwt.js';
dotenv.config();

const API_URL = process.env.API_URL || 'http://localhost:3000';
const DISCOVERY_ENDPOINT = `${API_URL}/discovery/businesses`;

// User ID from database
const USER_ID = '917b00f6-68d6-45ec-8654-2988b8311387';
const INDUSTRY_ID = '1e539953-2b2a-44fe-a7e6-78a2b98cab4c'; // Barbers
const CITY_ID = 'f7173014-48eb-488e-a8e7-46d4f8c83ef5'; // Athens
const DATASET_ID = '25ef6f9c-35d4-45c1-be87-c162aee9e899';

async function testDiscoveryV2() {
  console.log('🧪 Testing Discovery V2 Endpoint');
  console.log('============================');
  console.log(`API URL: ${API_URL}`);
  console.log(`Endpoint: ${DISCOVERY_ENDPOINT}`);
  console.log('');

  // Generate JWT token
  const token = generateToken({
    id: USER_ID,
    email: 'test@example.com',
    plan: 'pro'
  });

  console.log('✓ Generated JWT token');
  console.log('');

  const requestBody = {
    industryId: INDUSTRY_ID,
    cityId: CITY_ID,
    datasetId: DATASET_ID
  };

  console.log('📤 Request:');
  console.log('Body:', JSON.stringify(requestBody, null, 2));
  console.log('');

  try {
    // Wait a bit for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    const response = await fetch(DISCOVERY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${token}`
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
      console.log('   Look for 🚨 ABOUT TO INSERT BUSINESSES and ✅ INSERT ATTEMPT FINISHED');
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

testDiscoveryV2()
  .then(() => {
    console.log('');
    console.log('✅ Test completed');
    console.log('');
    console.log('Check server logs for:');
    console.log('  - 🚨 ABOUT TO INSERT BUSINESSES');
    console.log('  - ✅ INSERT ATTEMPT FINISHED');
    console.log('  - [discoverBusinessesV2] logs');
    process.exit(0);
  })
  .catch((error) => {
    console.error('');
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
