#!/usr/bin/env node

import dotenv from 'dotenv';
import { runDatasetExport } from '../workers/exportWorker.js';

dotenv.config();

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: npm run export <datasetId> --tier starter|pro|agency --format xlsx|csv');
    process.exit(1);
  }

  const datasetId = args[0];
  let tier = 'starter';
  let format = 'xlsx';

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--tier' && args[i + 1]) {
      tier = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--tier=')) {
      tier = arg.split('=')[1];
    } else if (arg === '--format' && args[i + 1]) {
      format = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--format=')) {
      format = arg.split('=')[1];
    }
  }

  try {
    const filePath = await runDatasetExport(datasetId, tier, format);
    console.log('\nExport completed successfully:');
    console.log(`  File path: ${filePath}`);
  } catch (error) {
    console.error('Export failed:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
