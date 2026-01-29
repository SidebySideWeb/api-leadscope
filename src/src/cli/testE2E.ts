/**
 * End-to-End Testing Script
 * 
 * Tests the complete workflow:
 * 1. Discover businesses
 * 2. Crawl 3-5 businesses
 * 3. View dashboard list (via API)
 * 4. Export CSV
 * 5. Download file
 * 
 * Usage:
 *   npm run test:e2e -- --user <userId> --plan demo|starter|pro
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { pool, testConnection } from '../config/database.js';
import { getOrCreateDataset } from '../db/datasets.js';
import { getOrCreateCity } from '../db/cities.js';
import { getOrCreateIndustry } from '../db/industries.js';
import { getCountryByCode } from '../db/countries.js';
import { discoverBusinesses } from '../workers/discoveryWorker.js';
import { crawlWorkerV1Simple } from '../workers/crawlWorkerV1Simple.js';
import { exportDatasetToCsv } from '../workers/exportWorkerV1.js';
import { applyCrawlGate, type Plan } from '../core/planLimits.js';
import { incrementCrawls } from '../db/usageTracking.js';
import { integerToUuid } from '../db/crawlResultsV1.js';

const args = process.argv.slice(2);

function getArg(name: string): string | null {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index === args.length - 1) {
    return null;
  }
  return args[index + 1];
}

const GREECE_COUNTRY_CODE = 'GR';

async function main() {
  const userId = getArg('user');
  const planArg = getArg('plan');

  if (!userId || !planArg) {
    console.error('Usage: npm run test:e2e -- --user <userId> --plan demo|starter|pro');
    process.exit(1);
  }

  const plan = planArg as Plan;
  if (!['demo', 'starter', 'pro'].includes(plan)) {
    console.error('Error: plan must be one of: demo, starter, pro');
    process.exit(1);
  }

  console.log('\n🧪 Starting End-to-End Testing Workflow');
  console.log('========================================\n');
  console.log(`User ID: ${userId}`);
  console.log(`Plan: ${plan}\n`);

  // Test database connection first
  console.log('🔌 Testing database connection...');
  const connected = await testConnection();
  if (!connected) {
    console.error('\n❌ Database connection failed!');
    console.error('Please check your .env file and ensure DATABASE_URL is set correctly.');
    console.error('Example: DATABASE_URL=postgresql://user:password@host:port/database');
    process.exit(1);
  }
  console.log('✅ Database connection successful\n');

  try {
    // Step 1: Create/Get Dataset
    console.log('📊 Step 1: Creating/Getting Dataset');
    const country = await getCountryByCode(GREECE_COUNTRY_CODE);
    if (!country) {
      throw new Error(`Country ${GREECE_COUNTRY_CODE} not found`);
    }

    const city = await getOrCreateCity('Athens', country.id);
    const industry = await getOrCreateIndustry('restaurant');
    const dataset = await getOrCreateDataset(userId, city.id, industry.id, `Test Dataset - ${new Date().toISOString()}`);
    
    console.log(`✅ Dataset ID: ${dataset.id}`);
    console.log(`   City: Athens (ID: ${city.id})`);
    console.log(`   Industry: restaurant (ID: ${industry.id})\n`);

    // Step 2: Discover Businesses
    console.log('🔍 Step 2: Discovering Businesses');
    const discoveryResult = await discoverBusinesses({
      industry: 'restaurant',
      city: 'Athens',
      useGeoGrid: true,
      datasetId: dataset.id,
    });

    console.log(`✅ Discovery completed:`);
    console.log(`   Businesses found: ${discoveryResult.businessesFound}`);
    console.log(`   Businesses created: ${discoveryResult.businessesCreated}`);
    console.log(`   Websites created: ${discoveryResult.websitesCreated}\n`);

    if (discoveryResult.businessesCreated === 0) {
      console.log('⚠️  No new businesses created. Using existing businesses...\n');
    }

    // Step 3: Get Businesses for Crawling
    console.log('📋 Step 3: Getting Businesses for Crawling');
    const businessesResult = await pool.query<{
      id: number;
      name: string;
      website_url: string | null;
    }>(
      `
      SELECT 
        b.id,
        b.name,
        (SELECT url FROM websites WHERE business_id = b.id ORDER BY created_at DESC LIMIT 1) AS website_url
      FROM businesses b
      WHERE b.dataset_id = $1
        AND EXISTS (SELECT 1 FROM websites WHERE business_id = b.id)
      ORDER BY b.created_at DESC
      LIMIT 5
      `,
      [dataset.id]
    );

    const businesses = businessesResult.rows.filter(b => b.website_url);
    console.log(`✅ Found ${businesses.length} businesses with websites\n`);

    if (businesses.length === 0) {
      console.error('❌ No businesses with websites found. Cannot proceed with crawling.');
      process.exit(1);
    }

    // Step 4: Crawl 3-5 Businesses
    console.log('🕷️  Step 4: Crawling Businesses');
    const businessesToCrawl = businesses.slice(0, Math.min(5, businesses.length));
    const crawlResults = [];

    for (let i = 0; i < businessesToCrawl.length; i++) {
      const business = businessesToCrawl[i];
      console.log(`\n   Crawling business ${i + 1}/${businessesToCrawl.length}: ${business.name}`);
      console.log(`   Website: ${business.website_url}`);

      const requestedDepth = 2;
      const gateResult = applyCrawlGate(plan, requestedDepth);

      if (gateResult.gated) {
        console.log(`   ⚠️  Plan limit applied: Depth capped to ${gateResult.maxDepth}, Pages limit: ${gateResult.pagesLimit}`);
      }

      try {
        const crawlResult = await crawlWorkerV1Simple({
          business: {
            id: business.id,
            website: business.website_url!,
          },
          maxDepth: gateResult.maxDepth,
          pagesLimit: gateResult.pagesLimit,
          datasetId: dataset.id,
        });

        if (crawlResult.success) {
          console.log(`   ✅ Crawl completed:`);
          console.log(`      Pages: ${crawlResult.pages_crawled}`);
          console.log(`      Emails: ${crawlResult.emails_found}`);
          console.log(`      Phones: ${crawlResult.phones_found}`);
          crawlResults.push(crawlResult);

          // Increment usage tracking
          try {
            await incrementCrawls(userId);
          } catch (usageError: any) {
            console.warn(`      Warning: Failed to update usage tracking: ${usageError.message}`);
          }
        } else {
          console.log(`   ❌ Crawl failed: ${crawlResult.error}`);
        }
      } catch (error: any) {
        console.log(`   ❌ Crawl error: ${error.message}`);
      }
    }

    console.log(`\n✅ Crawled ${crawlResults.length} businesses successfully\n`);

    // Step 5: View Dashboard List (via API simulation)
    console.log('📊 Step 5: Viewing Dashboard List (simulated)');
    
    // Get businesses with crawl results
    const businessesList = await pool.query<{
      id: number;
      name: string;
      website_url: string | null;
    }>(
      `
      SELECT
        b.id,
        b.name,
        (SELECT url FROM websites WHERE business_id = b.id ORDER BY created_at DESC LIMIT 1) AS website_url
      FROM businesses b
      WHERE b.dataset_id = $1
      ORDER BY b.created_at DESC
      LIMIT 10
      `,
      [dataset.id]
    );

    // Get crawl results separately and join in TypeScript
    const crawlResultsList = await pool.query<{
      business_id: string;
      crawl_status: string;
      emails: any[];
      phones: any[];
    }>(
      `
      SELECT
        business_id,
        crawl_status,
        emails,
        phones
      FROM crawl_results
      WHERE dataset_id = $1
      `,
      [dataset.id]
    );

    // Create map of business_id (UUID) -> crawl_result
    const crawlResultMap = new Map<string, typeof crawlResultsList.rows[0]>();
    for (const cr of crawlResultsList.rows) {
      crawlResultMap.set(cr.business_id, cr);
    }

    console.log(`✅ Found ${businessesList.rows.length} businesses in dataset`);
    businessesList.rows.slice(0, 5).forEach((b, i) => {
      const businessIdUuid = integerToUuid(b.id);
      const crawlResult = crawlResultMap.get(businessIdUuid);
      const emailsCount = crawlResult?.emails?.length || 0;
      const phonesCount = crawlResult?.phones?.length || 0;
      const status = crawlResult?.crawl_status || 'not_crawled';
      
      console.log(`   ${i + 1}. ${b.name}`);
      console.log(`      Website: ${b.website_url || 'No website'}`);
      console.log(`      Status: ${status} | Emails: ${emailsCount} | Phones: ${phonesCount}`);
    });
    console.log('');

    // Step 6: Export CSV
    console.log('📤 Step 6: Exporting CSV');
    const exportResult = await exportDatasetToCsv({
      datasetId: dataset.id,
      userId,
      plan,
    });

    if (exportResult.success) {
      console.log(`✅ Export completed successfully!`);
      console.log(`   Export ID: ${exportResult.exportId}`);
      console.log(`   File Path: ${exportResult.filePath}`);
      console.log(`   Rows Exported: ${exportResult.rowsExported} of ${exportResult.rowsTotal} total`);
      console.log(`   Watermark: ${exportResult.watermark}`);
    } else {
      console.error(`❌ Export failed: ${exportResult.error}`);
      process.exit(1);
    }

    // Step 7: Verify File Exists
    console.log('\n📁 Step 7: Verifying Export File');
    const fs = await import('fs/promises');
    const path = await import('path');

    if (exportResult.filePath) {
      try {
        const stats = await fs.stat(exportResult.filePath);
        console.log(`✅ File exists: ${exportResult.filePath}`);
        console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`);
        console.log(`   Created: ${stats.birthtime.toISOString()}`);
      } catch (error: any) {
        console.error(`❌ File not found: ${exportResult.filePath}`);
        console.error(`   Error: ${error.message}`);
      }
    }

    console.log('\n✅ End-to-End Testing Workflow Complete!');
    console.log(`\n📝 Summary:`);
    console.log(`   Dataset ID: ${dataset.id}`);
    console.log(`   Businesses discovered: ${discoveryResult.businessesCreated}`);
    console.log(`   Businesses crawled: ${crawlResults.length}`);
    console.log(`   Export file: ${exportResult.filePath || 'N/A'}`);
    console.log(`   Rows exported: ${exportResult.rowsExported}`);

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
