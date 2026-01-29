#!/usr/bin/env node

/**
 * Crawl Worker v1 CLI
 * Usage: npm run crawl -- --dataset <uuid> [options]
 */

import dotenv from 'dotenv';
import { crawlDataset } from '../workers/crawlWorker.js';
import type { CrawlOptions } from '../types/crawl.js';
import { logger } from '../utils/logger.js';

dotenv.config();

function parseArgs(): { datasetId: string; options: CrawlOptions } {
  const args = process.argv.slice(2);
  let datasetId = '';
  const options: CrawlOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg === '--dataset' && nextArg) {
      datasetId = nextArg;
      i++;
    } else if (arg === '--limit' && nextArg) {
      // Not used directly, but could limit businesses
      i++;
    } else if (arg === '--concurrency' && nextArg) {
      options.concurrency = Number.parseInt(nextArg, 10);
      i++;
    } else if (arg === '--max-pages' && nextArg) {
      options.maxPages = Number.parseInt(nextArg, 10);
      i++;
    } else if (arg === '--depth' && nextArg) {
      options.maxDepth = Number.parseInt(nextArg, 10);
      i++;
    } else if (arg.startsWith('--dataset=')) {
      datasetId = arg.split('=')[1];
    } else if (arg.startsWith('--concurrency=')) {
      options.concurrency = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--max-pages=')) {
      options.maxPages = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--depth=')) {
      options.maxDepth = Number.parseInt(arg.split('=')[1], 10);
    }
  }

  if (!datasetId) {
    console.error('Error: --dataset <uuid> is required');
    console.error('\nUsage: npm run crawl -- --dataset <uuid> [options]');
    console.error('\nOptions:');
    console.error('  --dataset <uuid>     Dataset ID (required)');
    console.error('  --concurrency <n>    Concurrent crawls (default: 3)');
    console.error('  --max-pages <n>      Max pages per domain (default: 15)');
    console.error('  --depth <n>          Max crawl depth (default: 2)');
    process.exit(1);
  }

  // Validate UUID format (basic)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(datasetId)) {
    console.error('Error: Invalid UUID format for dataset');
    process.exit(1);
  }

  return { datasetId, options };
}

async function main() {
  try {
    const { datasetId, options } = parseArgs();

    logger.info(`Starting crawl for dataset: ${datasetId}`);
    logger.info(`Options:`, options);

    const summary = await crawlDataset(datasetId, options);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('Crawl Summary');
    console.log('='.repeat(60));
    console.log(`Dataset ID:     ${summary.dataset_id}`);
    console.log(`Total Businesses: ${summary.total_businesses}`);
    console.log(`Crawled:        ${summary.crawled}`);
    console.log(`Failed:         ${summary.failed}`);
    console.log(`Skipped:        ${summary.skipped}`);
    console.log(`Total Pages:    ${summary.total_pages}`);
    console.log(`Total Emails:   ${summary.total_emails}`);
    console.log(`Total Phones:   ${summary.total_phones}`);
    console.log(`Started:        ${summary.started_at}`);
    console.log(`Finished:       ${summary.finished_at}`);
    
    if (summary.errors.length > 0) {
      console.log(`\nErrors (${summary.errors.length}):`);
      summary.errors.slice(0, 10).forEach(err => {
        console.log(`  - ${err.business_id}: ${err.error}`);
      });
      if (summary.errors.length > 10) {
        console.log(`  ... and ${summary.errors.length - 10} more`);
      }
    }
    
    console.log('='.repeat(60) + '\n');

    process.exit(0);
  } catch (error) {
    logger.error('Crawl failed:', error);
    process.exit(1);
  }
}

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
