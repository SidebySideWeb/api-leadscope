/**
 * CLI for Export Dataset to CSV
 * 
 * Usage:
 *   npm run export:dataset -- --dataset <uuid> --user <userId> --plan demo|starter|pro
 */

import { exportDatasetToCsv } from '../workers/exportWorkerV1.js';
import type { Plan } from '../core/planLimits.js';

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
  const userId = getArg('user');
  const planArg = getArg('plan');

  if (!datasetId || !userId || !planArg) {
    console.error('Usage: npm run export:dataset -- --dataset <uuid> --user <userId> --plan demo|starter|pro');
    process.exit(1);
  }

  const plan = planArg as Plan;
  if (!['demo', 'starter', 'pro'].includes(plan)) {
    console.error('Error: plan must be one of: demo, starter, pro');
    process.exit(1);
  }

  console.log(`\n📊 Exporting dataset ${datasetId} to CSV`);
  console.log(`   User: ${userId}`);
  console.log(`   Plan: ${plan}\n`);

  try {
    const result = await exportDatasetToCsv({
      datasetId,
      userId,
      plan,
    });

    if (result.success) {
      console.log(`\n✅ Export completed successfully!`);
      console.log(`   Export ID: ${result.exportId}`);
      console.log(`   File Path: ${result.filePath}`);
      console.log(`   Rows Exported: ${result.rowsExported} of ${result.rowsTotal} total`);
      console.log(`   Watermark: ${result.watermark}`);
    } else {
      console.error(`\n❌ Export failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
