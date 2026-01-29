/**
 * CLI for Crawl Worker v1 Simple
 * 
 * Usage:
 *   npm run crawl-simple -- --business-id <id> --website <url> --max-depth <n> --dataset <uuid> --plan demo|starter|pro [--user <userId>]
 */

import { crawlWorkerV1Simple } from '../workers/crawlWorkerV1Simple.js';
import { applyCrawlGate, type Plan } from '../core/planLimits.js';
import { incrementCrawls } from '../db/usageTracking.js';

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
  const website = getArg('website');
  const maxDepth = getArg('max-depth');
  const datasetId = getArg('dataset');
  const planArg = getArg('plan');
  const userId = getArg('user');

  if (!businessId || !website || !maxDepth || !datasetId || !planArg) {
    console.error('Usage: npm run crawl-simple -- --business-id <id> --website <url> --max-depth <n> --dataset <uuid> --plan demo|starter|pro [--user <userId>]');
    process.exit(1);
  }

  const plan = planArg as Plan;
  if (!['demo', 'starter', 'pro'].includes(plan)) {
    console.error('Error: plan must be one of: demo, starter, pro');
    process.exit(1);
  }

  const requestedDepth = Number.parseInt(maxDepth, 10);
  if (isNaN(requestedDepth) || requestedDepth < 0) {
    console.error('Error: max-depth must be a non-negative number');
    process.exit(1);
  }

  // Apply plan-based gates before crawl
  const gateResult = applyCrawlGate(plan, requestedDepth);
  
  console.log(`\n🔍 Starting crawl for business ${businessId}`);
  console.log(`   Website: ${website}`);
  console.log(`   Requested Depth: ${requestedDepth}`);
  console.log(`   Plan: ${plan}`);
  if (gateResult.gated) {
    console.log(`   ⚠️  Plan limit applied: Depth capped to ${gateResult.maxDepth}, Pages limit: ${gateResult.pagesLimit}`);
  } else {
    console.log(`   Max Depth: ${gateResult.maxDepth}, Pages Limit: ${gateResult.pagesLimit}`);
  }
  console.log(`   Dataset: ${datasetId}\n`);

  try {
    const result = await crawlWorkerV1Simple({
      business: {
        id: Number.parseInt(businessId, 10),
        website,
      },
      maxDepth: gateResult.maxDepth, // Use gated depth
      pagesLimit: gateResult.pagesLimit, // Pass pages limit
      datasetId,
    });

    if (result.success) {
      console.log(`\n✅ Crawl completed successfully`);
      console.log(`   Pages crawled: ${result.pages_crawled}`);
      console.log(`   Emails found: ${result.emails_found}`);
      console.log(`   Phones found: ${result.phones_found}`);
      console.log(`   Social links: ${result.social_links_found}`);
      console.log(`   Contacts saved: ${result.contacts_saved}`);
      
      // Increment usage tracking if userId provided
      if (userId) {
        try {
          await incrementCrawls(userId);
          console.log(`   Usage tracking updated`);
        } catch (usageError: any) {
          console.warn(`   Warning: Failed to update usage tracking: ${usageError.message}`);
        }
      }
    } else {
      console.error(`\n❌ Crawl failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
