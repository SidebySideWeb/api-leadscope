/**
 * Re-crawl existing businesses in a dataset
 * 
 * Fetches businesses from database that have websites and re-crawls them
 * to update crawl_results with fresh data.
 * 
 * Usage:
 *   npm run recrawl:dataset -- --dataset <uuid> --plan demo|starter|pro [--user <userId>] [--limit <number>]
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { pool } from '../config/database.js';
import { getDatasetById } from '../db/datasets.js';
import { crawlWorkerV1Simple } from '../workers/crawlWorkerV1Simple.js';
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

async function main() {
  const datasetId = getArg('dataset');
  const planArg = getArg('plan');
  const userId = getArg('user');
  const limitArg = getArg('limit');

  if (!datasetId || !planArg) {
    console.error('Usage: npm run recrawl:dataset -- --dataset <uuid> --plan demo|starter|pro [--user <userId>] [--limit <number>]');
    process.exit(1);
  }

  const plan = planArg as Plan;
  if (!['demo', 'starter', 'pro'].includes(plan)) {
    console.error('Error: plan must be one of: demo, starter, pro');
    process.exit(1);
  }

  const limit = limitArg ? parseInt(limitArg, 10) : undefined;
  if (limit !== undefined && (isNaN(limit) || limit < 1)) {
    console.error('Error: limit must be a positive number');
    process.exit(1);
  }

  console.log('\n🔄 Re-crawling Dataset Businesses');
  console.log('==================================\n');
  console.log(`Dataset ID: ${datasetId}`);
  console.log(`Plan: ${plan}`);
  if (limit) {
    console.log(`Limit: ${limit} businesses`);
  }
  console.log('');

  try {
    // 1. Verify dataset exists
    const dataset = await getDatasetById(datasetId);
    if (!dataset) {
      console.error(`❌ Dataset ${datasetId} not found`);
      process.exit(1);
    }

    // 2. Fetch businesses with websites
    const businessesQuery = await pool.query<{
      id: number;
      name: string;
      website_url: string;
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
      ${limit ? `LIMIT ${limit}` : ''}
      `,
      [datasetId]
    );

    const businesses = businessesQuery.rows.filter(b => b.website_url);
    console.log(`✅ Found ${businesses.length} businesses with websites to re-crawl\n`);

    if (businesses.length === 0) {
      console.log('⚠️  No businesses with websites found. Nothing to crawl.');
      process.exit(0);
    }

    // 3. Apply plan-based gates
    const requestedDepth = 2;
    const gateResult = applyCrawlGate(plan, requestedDepth);
    
    console.log(`Plan limits applied:`);
    console.log(`  Max depth: ${gateResult.maxDepth}`);
    console.log(`  Max pages per crawl: ${gateResult.pagesLimit}`);
    if (gateResult.gated) {
      console.log(`  ⚠️  Limits applied (requested depth ${requestedDepth} was capped)\n`);
    } else {
      console.log('');
    }

    // 4. Re-crawl each business
    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < businesses.length; i++) {
      const business = businesses[i];
      console.log(`\n[${i + 1}/${businesses.length}] Re-crawling: ${business.name}`);
      console.log(`   Website: ${business.website_url}`);

      try {
        const crawlResult = await crawlWorkerV1Simple({
          business: {
            id: business.id,
            website: business.website_url,
          },
          maxDepth: gateResult.maxDepth,
          pagesLimit: gateResult.pagesLimit,
          datasetId,
        });

        if (crawlResult.success) {
          successCount++;
          console.log(`   ✅ Success:`);
          console.log(`      Pages: ${crawlResult.pages_crawled}`);
          console.log(`      Emails: ${crawlResult.emails_found}`);
          console.log(`      Phones: ${crawlResult.phones_found}`);
          console.log(`      Social: ${crawlResult.social_links_found}`);
          results.push(crawlResult);

          // Increment usage tracking if userId provided
          if (userId) {
            try {
              await incrementCrawls(userId);
            } catch (usageError: any) {
              console.warn(`      Warning: Failed to update usage tracking: ${usageError.message}`);
            }
          }
        } else {
          failCount++;
          console.log(`   ❌ Failed: ${crawlResult.error}`);
        }
      } catch (error: any) {
        failCount++;
        console.log(`   ❌ Error: ${error.message}`);
      }

      // Small delay between crawls to avoid rate limiting
      if (i < businesses.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // 5. Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 Re-crawl Summary');
    console.log('='.repeat(50));
    console.log(`Total businesses: ${businesses.length}`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`\nCrawl results have been updated in the database.`);
    console.log(`You can now export the dataset to see the updated contacts.`);

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
