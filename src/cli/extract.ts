#!/usr/bin/env node

import dotenv from 'dotenv';
import { runExtractionBatch } from '../workers/extractWorker.js';

dotenv.config();

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: npm run extract <batchSize>');
    process.exit(1);
  }

  const batchSizeRaw = args[0];
  const batchSize = Number.parseInt(batchSizeRaw, 10);

  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    console.error('batchSize must be a positive integer');
    process.exit(1);
  }

  try {
    await runExtractionBatch(batchSize);
    console.log('Extraction batch completed.');
  } catch (error) {
    console.error('Extraction batch failed:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
