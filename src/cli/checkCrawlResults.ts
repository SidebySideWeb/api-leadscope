/**
 * Diagnostic script to check crawl_results data
 * 
 * Usage:
 *   npm run check:crawl-results -- --dataset <uuid>
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
  const datasetId = getArg('dataset');

  if (!datasetId) {
    console.error('Usage: npm run check:crawl-results -- --dataset <uuid>');
    process.exit(1);
  }

  console.log(`\n🔍 Checking crawl_results for dataset: ${datasetId}\n`);

  try {
    // 1. Check businesses in dataset
    const businessesResult = await pool.query<{
      id: number;
      name: string;
    }>(
      `SELECT id, name FROM businesses WHERE dataset_id = $1 ORDER BY id LIMIT 10`,
      [datasetId]
    );

    console.log(`📊 Businesses in dataset: ${businessesResult.rows.length} (showing first 10)`);
    for (const biz of businessesResult.rows) {
      const businessIdUuid = integerToUuid(biz.id);
      console.log(`  Business ID: ${biz.id} → UUID: ${businessIdUuid} | Name: ${biz.name}`);
    }
    console.log('');

    // 2. Check crawl_results for this dataset
    const crawlResultsResult = await pool.query<{
      business_id: string;
      crawl_status: string;
      emails: any;
      phones: any;
      social: any;
      pages_visited: number;
      finished_at: string | null;
    }>(
      `SELECT 
        business_id,
        crawl_status,
        emails,
        phones,
        social,
        pages_visited,
        finished_at
      FROM crawl_results
      WHERE dataset_id = $1
      ORDER BY business_id
      LIMIT 10`,
      [datasetId]
    );

    console.log(`📊 Crawl results in dataset: ${crawlResultsResult.rows.length} (showing first 10)`);
    
    if (crawlResultsResult.rows.length === 0) {
      console.log('  ⚠️  NO CRAWL RESULTS FOUND!');
      console.log('  This means businesses have not been crawled yet.');
      console.log('  Run: npm run recrawl:dataset -- --dataset <uuid> --plan demo');
    } else {
      for (const cr of crawlResultsResult.rows) {
        const emailsCount = Array.isArray(cr.emails) ? cr.emails.length : 0;
        const phonesCount = Array.isArray(cr.phones) ? cr.phones.length : 0;
        const socialCount = cr.social && typeof cr.social === 'object' ? Object.keys(cr.social).length : 0;
        
        console.log(`  Business UUID: ${cr.business_id}`);
        console.log(`    Status: ${cr.crawl_status}`);
        console.log(`    Pages: ${cr.pages_visited}`);
        console.log(`    Emails: ${emailsCount} | Phones: ${phonesCount} | Social: ${socialCount}`);
        console.log(`    Finished: ${cr.finished_at || 'N/A'}`);
        
        if (emailsCount > 0) {
          console.log(`    Email samples: ${JSON.stringify(cr.emails.slice(0, 2))}`);
        }
        if (phonesCount > 0) {
          console.log(`    Phone samples: ${JSON.stringify(cr.phones.slice(0, 2))}`);
        }
        console.log('');
      }
    }

    // 3. Check if business_id UUIDs match
    console.log('🔗 Matching businesses to crawl_results:');
    let matched = 0;
    let unmatched = 0;

    for (const biz of businessesResult.rows) {
      const businessIdUuid = integerToUuid(biz.id);
      const hasCrawlResult = crawlResultsResult.rows.some(cr => cr.business_id === businessIdUuid);
      
      if (hasCrawlResult) {
        matched++;
        console.log(`  ✅ Business ${biz.id} (${biz.name}) → Has crawl result`);
      } else {
        unmatched++;
        console.log(`  ❌ Business ${biz.id} (${biz.name}) → NO crawl result (UUID: ${businessIdUuid})`);
      }
    }

    console.log(`\n📈 Summary:`);
    console.log(`  Total businesses: ${businessesResult.rows.length}`);
    console.log(`  With crawl results: ${matched}`);
    console.log(`  Without crawl results: ${unmatched}`);

    if (unmatched > 0) {
      console.log(`\n💡 To populate crawl results, run:`);
      console.log(`   npm run recrawl:dataset -- --dataset ${datasetId} --plan demo`);
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
