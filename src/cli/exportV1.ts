/**
 * CLI for Export Worker v1
 * 
 * Usage:
 *   npm run export:v1 -- <datasetId> <format> <userPlan>
 * 
 * Example:
 *   npm run export:v1 -- "123e4567-e89b-12d3-a456-426614174000" csv demo
 */

import { exportWorkerV1 } from '../workers/exportWorkerV1.js';
import fs from 'fs/promises';
import path from 'path';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('Usage: npm run export:v1 -- <datasetId> <format> <userPlan>');
    console.error('  datasetId: UUID of the dataset to export');
    console.error('  format: csv or xlsx');
    console.error('  userPlan: demo, starter, or pro');
    process.exit(1);
  }

  const [datasetId, format, userPlan] = args;

  // Validate format
  if (format !== 'csv' && format !== 'xlsx') {
    console.error(`Invalid format: ${format}. Must be 'csv' or 'xlsx'`);
    process.exit(1);
  }

  // Validate userPlan
  if (userPlan !== 'demo' && userPlan !== 'starter' && userPlan !== 'pro') {
    console.error(`Invalid userPlan: ${userPlan}. Must be 'demo', 'starter', or 'pro'`);
    process.exit(1);
  }

  console.log(`[exportV1] Starting export for dataset: ${datasetId}`);
  console.log(`[exportV1] Format: ${format}, Plan: ${userPlan}`);

  try {
    const result = await exportWorkerV1({
      datasetId,
      format: format as 'csv' | 'xlsx',
      userPlan: userPlan as 'demo' | 'starter' | 'pro',
    });

    if (!result.success) {
      console.error(`[exportV1] Export failed: ${result.error}`);
      process.exit(1);
    }

    console.log(`[exportV1] Export completed successfully`);
    console.log(`[exportV1] Rows returned: ${result.rows_returned}`);
    console.log(`[exportV1] Rows total: ${result.rows_total}`);
    console.log(`[exportV1] Gated: ${result.gated ? 'Yes' : 'No'}`);

    if (result.gated && result.upgrade_hint) {
      console.log(`[exportV1] Upgrade hint: ${result.upgrade_hint}`);
    }

    // Save file to exports directory
    if (result.file && result.filename) {
      const exportsDir = path.join(process.cwd(), 'exports');
      await fs.mkdir(exportsDir, { recursive: true });
      
      const filePath = path.join(exportsDir, result.filename);
      await fs.writeFile(filePath, result.file);
      
      console.log(`[exportV1] File saved: ${filePath}`);
    } else {
      console.warn(`[exportV1] No file generated`);
    }
  } catch (error: any) {
    console.error(`[exportV1] Error:`, error);
    process.exit(1);
  }
}

main();
