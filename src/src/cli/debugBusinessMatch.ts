/**
 * Debug script to check UUID matching between businesses and crawl_results
 * 
 * Usage:
 *   npm run debug:business-match -- --business-uuid <uuid>
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { pool } from '../config/database.js';
import { integerToUuid } from '../db/crawlResultsV1.js';

const args = process.argv.slice(2);

function getArg(name: string): string | null {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index === args.length - 1) {
    return null;
  }
  return args[index + 1];
}

async function main() {
  const businessUuid = getArg('business-uuid');

  if (!businessUuid) {
    console.error('Usage: npm run debug:business-match -- --business-uuid <uuid>');
    process.exit(1);
  }

  console.log(`\n🔍 Debugging business UUID matching: ${businessUuid}\n`);

  try {
    // 1. Check crawl_results for this UUID
    const crawlResult = await pool.query<{
      business_id: string;
      dataset_id: string;
      crawl_status: string;
      emails: any;
      phones: any;
      social: any;
      pages_visited: number;
    }>(
      `SELECT 
        business_id,
        dataset_id,
        crawl_status,
        emails,
        phones,
        social,
        pages_visited
      FROM crawl_results
      WHERE business_id = $1`,
      [businessUuid]
    );

    if (crawlResult.rows.length === 0) {
      console.log(`❌ No crawl_results found for UUID: ${businessUuid}`);
      process.exit(1);
    }

    const cr = crawlResult.rows[0];
    console.log(`✅ Found crawl_result:`);
    console.log(`   Dataset ID: ${cr.dataset_id}`);
    console.log(`   Status: ${cr.crawl_status}`);
    console.log(`   Pages: ${cr.pages_visited}`);
    console.log(`   Emails: ${Array.isArray(cr.emails) ? cr.emails.length : 0}`);
    console.log(`   Phones: ${Array.isArray(cr.phones) ? cr.phones.length : 0}`);
    console.log(`   Social: ${cr.social && typeof cr.social === 'object' ? Object.keys(cr.social).length : 0}`);
    
    if (Array.isArray(cr.emails) && cr.emails.length > 0) {
      console.log(`   Email samples: ${JSON.stringify(cr.emails.slice(0, 3), null, 2)}`);
    }
    if (Array.isArray(cr.phones) && cr.phones.length > 0) {
      console.log(`   Phone samples: ${JSON.stringify(cr.phones.slice(0, 3), null, 2)}`);
    }
    console.log('');

    // 2. Try to find matching business by converting UUID back to integer
    // The UUID format is: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    // We need to extract the hex and convert back to integer
    const uuidParts = businessUuid.replace(/-/g, '');
    const hexString = uuidParts.substring(0, 16); // First 16 hex chars
    const possibleIntegerId = parseInt(hexString, 16);

    console.log(`🔢 Attempting to find business:`);
    console.log(`   UUID hex (first 16): ${hexString}`);
    console.log(`   Possible integer ID: ${possibleIntegerId}`);

    // 3. Check if any business in the dataset matches
    const businessesResult = await pool.query<{
      id: number;
      name: string;
      dataset_id: string;
    }>(
      `SELECT id, name, dataset_id 
       FROM businesses 
       WHERE dataset_id = $1
       ORDER BY id`,
      [cr.dataset_id]
    );

    console.log(`\n📊 Businesses in dataset ${cr.dataset_id}: ${businessesResult.rows.length}`);
    console.log(`   Checking UUID conversions...\n`);

    let foundMatch = false;
    for (const biz of businessesResult.rows) {
      const convertedUuid = integerToUuid(biz.id);
      const matches = convertedUuid === businessUuid;
      
      if (matches) {
        foundMatch = true;
        console.log(`   ✅ MATCH FOUND!`);
        console.log(`      Business ID: ${biz.id}`);
        console.log(`      Business Name: ${biz.name}`);
        console.log(`      Converted UUID: ${convertedUuid}`);
        console.log(`      Crawl Result UUID: ${businessUuid}`);
        console.log(`      Match: ${matches}`);
        break;
      }
    }

    if (!foundMatch) {
      console.log(`   ❌ NO MATCH FOUND!`);
      console.log(`   The UUID ${businessUuid} does not match any business ID conversion.`);
      console.log(`\n   This suggests:`);
      console.log(`   1. The business_id in crawl_results was stored with a different UUID format`);
      console.log(`   2. Or the business was deleted/changed`);
      console.log(`\n   Checking all businesses and their UUID conversions:`);
      
      for (const biz of businessesResult.rows.slice(0, 10)) {
        const convertedUuid = integerToUuid(biz.id);
        console.log(`      Business ${biz.id} (${biz.name}) → ${convertedUuid}`);
      }
    }

    // 4. Check if there's a direct integer match (if UUID was stored incorrectly)
    const directMatch = await pool.query<{
      id: number;
      name: string;
    }>(
      `SELECT id, name 
       FROM businesses 
       WHERE id = $1 AND dataset_id = $2`,
      [possibleIntegerId, cr.dataset_id]
    );

    if (directMatch.rows.length > 0) {
      console.log(`\n   💡 Found business with integer ID ${possibleIntegerId}:`);
      console.log(`      Name: ${directMatch.rows[0].name}`);
      console.log(`      This might be the correct business, but UUID doesn't match.`);
    }

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
