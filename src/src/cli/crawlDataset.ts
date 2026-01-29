/**
 * CLI: Dataset-wide Crawl (no Redis)
 *
 * Usage:
 *   npm run crawl:dataset -- --dataset <uuid> --max-depth 2 --concurrency 3 --user <userId>
 */

import { enqueueCrawlJobsForDataset, processDatasetCrawlJobs } from '../crawl/datasetCrawlRunner.js';
import { getDatasetById } from '../db/datasets.js';
import { getUserPermissions } from '../db/permissions.js';

function getArg(name: string): string | null {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index === args.length - 1) {
    return null;
  }
  return args[index + 1];
}

async function main() {
  const datasetId = getArg('dataset');
  const maxDepthArg = getArg('max-depth');
  const concurrencyArg = getArg('concurrency');
  const userIdArg = getArg('user');

  if (!datasetId) {
    console.error('Error: --dataset <uuid> is required');
    process.exit(1);
  }

  const maxDepth = maxDepthArg ? Number.parseInt(maxDepthArg, 10) : 2;
  const concurrency = concurrencyArg ? Number.parseInt(concurrencyArg, 10) : 3;

  try {
    const dataset = await getDatasetById(datasetId);
    if (!dataset) {
      console.error(`Error: Dataset not found: ${datasetId}`);
      process.exit(1);
    }

    const userId = userIdArg || dataset.user_id;

    console.log('\n📡 Dataset-wide crawl');
    console.log(`   Dataset: ${datasetId}`);
    console.log(`   User:    ${userId}`);
    console.log(`   Max depth (requested): ${maxDepth}`);
    console.log(`   Concurrency: ${concurrency}\n`);

    // Resolve plan + effective depth
    const permissions = await getUserPermissions(userId);
    const planId = permissions.plan;
    const isInternalUser = permissions.is_internal_user;
    const effectiveMaxDepth = isInternalUser
      ? Math.min(maxDepth, 10)
      : Math.min(maxDepth, permissions.max_crawl_pages);

    console.log(
      `   Plan: ${planId} (internal=${isInternalUser}) -> effective depth: ${effectiveMaxDepth}\n`,
    );

    // Enqueue crawl jobs (idempotent)
    console.log('➕ Enqueuing crawl jobs for dataset businesses with websites...');
    const enqueueResult = await enqueueCrawlJobsForDataset(datasetId, effectiveMaxDepth * 10);

    console.log(
      `   Businesses with websites: ${enqueueResult.totalBusinesses}\n` +
        `   Jobs created:            ${enqueueResult.jobsCreated}\n` +
        `   Jobs skipped (existing): ${enqueueResult.jobsSkipped}\n`,
    );

    // Process jobs
    console.log('🚀 Processing crawl jobs...\n');
    await processDatasetCrawlJobs({
      datasetId,
      userId,
      maxDepth: effectiveMaxDepth,
      concurrency,
    });

    console.log('\n✅ Dataset crawl completed.\n');
  } catch (error: any) {
    console.error('\n❌ Dataset crawl failed:', error?.message || String(error));
    process.exit(1);
  }
}

main();

