/**
 * Test script for crawl_results v1 DB persistence
 * 
 * Usage:
 *   npm run test:crawl-results-v1 -- --business-id <id> --dataset <uuid>
 * 
 * This script verifies that crawl results can be persisted to the database.
 * It checks the row count before and after a test upsert.
 */

import { pool } from '../config/database.js';
import { upsertCrawlResultV1 } from '../db/crawlResultsV1.js';

const args = process.argv.slice(2);

function getArg(name: string): string | null {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index === args.length - 1) {
    return null;
  }
  return args[index + 1];
}

async function main() {
  const businessId = getArg('business-id');
  const datasetId = getArg('dataset');

  if (!businessId || !datasetId) {
    console.error('Usage: npm run test:crawl-results-v1 -- --business-id <id> --dataset <uuid>');
    process.exit(1);
  }

  console.log(`\n🧪 Testing crawl_results v1 DB persistence`);
  console.log(`   Business ID: ${businessId}`);
  console.log(`   Dataset ID: ${datasetId}\n`);

  try {
    // Count existing rows before test
    const beforeResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM crawl_results WHERE business_id = $1 AND dataset_id = $2`,
      [businessId, datasetId]
    );
    const beforeCount = parseInt(beforeResult.rows[0].count, 10);
    console.log(`   Rows before test: ${beforeCount}`);

    // Perform test upsert
    const startedAt = new Date();
    const finishedAt = new Date();
    
    await upsertCrawlResultV1({
      businessId,
      datasetId,
      websiteUrl: 'https://example.com',
      startedAt,
      finishedAt,
      pagesVisited: 1,
      crawlStatus: 'completed',
      emails: [
        { value: 'test@example.com', source_url: 'https://example.com' },
      ],
      phones: [
        { value: '+1234567890', source_url: 'https://example.com' },
      ],
      contactPages: ['https://example.com/contact'],
      social: {
        facebook: 'https://facebook.com/example',
      },
      errors: [],
    });

    console.log(`   ✅ Upsert completed`);

    // Count rows after test
    const afterResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM crawl_results WHERE business_id = $1 AND dataset_id = $2`,
      [businessId, datasetId]
    );
    const afterCount = parseInt(afterResult.rows[0].count, 10);
    console.log(`   Rows after test: ${afterCount}`);

    if (afterCount === beforeCount + 1) {
      console.log(`\n✅ Test passed: New row inserted`);
    } else if (afterCount === beforeCount && beforeCount > 0) {
      console.log(`\n✅ Test passed: Existing row updated`);
    } else {
      console.log(`\n⚠️  Unexpected row count change: ${beforeCount} -> ${afterCount}`);
    }

    // Verify the row data
    const rowResult = await pool.query(
      `SELECT * FROM crawl_results WHERE business_id = $1 AND dataset_id = $2`,
      [businessId, datasetId]
    );
    
    if (rowResult.rows.length > 0) {
      const row = rowResult.rows[0];
      console.log(`\n📊 Row data:`);
      console.log(`   Website URL: ${row.website_url}`);
      console.log(`   Pages visited: ${row.pages_visited}`);
      console.log(`   Crawl status: ${row.crawl_status}`);
      console.log(`   Emails: ${JSON.stringify(row.emails)}`);
      console.log(`   Phones: ${JSON.stringify(row.phones)}`);
      console.log(`   Contact pages: ${JSON.stringify(row.contact_pages)}`);
      console.log(`   Social: ${JSON.stringify(row.social)}`);
      console.log(`   Errors: ${JSON.stringify(row.errors)}`);
    }

    process.exit(0);
  } catch (error: any) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
