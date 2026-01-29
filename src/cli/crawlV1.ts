/**
 * CLI for Crawl Worker v1
 * 
 * Usage:
 *   npm run crawl:v1 -- <businessId> <datasetId> <websiteUrl> <userPlan>
 * 
 * Example:
 *   npm run crawl:v1 -- 123 "123e4567-e89b-12d3-a456-426614174000" "https://example.com" demo
 */

import { crawlWorkerV1 } from '../workers/crawlWorkerV1.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.error('Usage: npm run crawl:v1 -- <businessId> <datasetId> <websiteUrl> <userPlan>');
    console.error('  businessId: Integer business ID');
    console.error('  datasetId: UUID of the dataset');
    console.error('  websiteUrl: Website URL to crawl');
    console.error('  userPlan: demo, starter, or pro');
    process.exit(1);
  }

  const [businessIdStr, datasetId, websiteUrl, userPlan] = args;

  // Validate businessId
  const businessId = parseInt(businessIdStr, 10);
  if (isNaN(businessId)) {
    console.error(`Invalid businessId: ${businessIdStr}. Must be an integer.`);
    process.exit(1);
  }

  // Validate userPlan
  if (userPlan !== 'demo' && userPlan !== 'starter' && userPlan !== 'pro') {
    console.error(`Invalid userPlan: ${userPlan}. Must be 'demo', 'starter', or 'pro'`);
    process.exit(1);
  }

  console.log(`[crawlV1] Starting crawl for business: ${businessId}`);
  console.log(`[crawlV1] Dataset: ${datasetId}`);
  console.log(`[crawlV1] Website: ${websiteUrl}`);
  console.log(`[crawlV1] Plan: ${userPlan}`);

  try {
    const result = await crawlWorkerV1({
      businessId,
      datasetId,
      websiteUrl,
      userPlan: userPlan as 'demo' | 'starter' | 'pro',
    });

    if (!result.success) {
      console.error(`[crawlV1] Crawl failed: ${result.error}`);
      process.exit(1);
    }

    console.log(`[crawlV1] Crawl completed successfully`);
    console.log(`[crawlV1] Pages visited: ${result.pages_visited} / ${result.pages_limit}`);
    console.log(`[crawlV1] Gated: ${result.gated ? 'Yes' : 'No'}`);
    console.log(`[crawlV1] Status: ${result.crawl_status}`);
    console.log(`[crawlV1] Emails found: ${result.emails_found}`);
    console.log(`[crawlV1] Phones found: ${result.phones_found}`);
    console.log(`[crawlV1] Contact pages found: ${result.contact_pages_found}`);

    if (result.gated && result.upgrade_hint) {
      console.log(`[crawlV1] Upgrade hint: ${result.upgrade_hint}`);
    }

    if (result.error) {
      console.warn(`[crawlV1] Warning: ${result.error}`);
    }
  } catch (error: any) {
    console.error(`[crawlV1] Error:`, error);
    process.exit(1);
  }
}

main();
