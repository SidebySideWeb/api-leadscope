/**
 * CLI: Sync/Refresh Businesses
 * 
 * Monthly sync job to refresh business data from Google Places API.
 * Updates existing businesses with fresh information.
 * 
 * Usage:
 *   npm run sync:businesses [--dataset <uuid>] [--limit <number>]
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { syncDatasetBusinesses, syncAllBusinesses } from '../services/businessSyncService.js';
import { pool } from '../config/database.js';

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
  const limitArg = getArg('limit');

  const limit = limitArg ? parseInt(limitArg, 10) : undefined;
  if (limit !== undefined && (isNaN(limit) || limit < 1)) {
    console.error('Error: limit must be a positive number');
    process.exit(1);
  }

  try {
    if (datasetId) {
      console.log(`\n🔄 Syncing businesses for dataset: ${datasetId}`);
      if (limit) {
        console.log(`   Limit: ${limit} businesses`);
      }
      const result = await syncDatasetBusinesses(datasetId, limit);
      
      if (result.errors.length > 0) {
        console.error(`\n⚠️  Completed with ${result.errors.length} errors`);
        process.exit(1);
      }
    } else {
      console.log(`\n🔄 Running monthly sync for all businesses`);
      if (limit) {
        console.log(`   Limit: ${limit} businesses`);
      }
      const result = await syncAllBusinesses(limit);
      
      if (result.errors.length > 0) {
        console.error(`\n⚠️  Completed with ${result.errors.length} errors`);
        process.exit(1);
      }
    }

    console.log(`\n✅ Sync completed successfully`);
  } catch (error: any) {
    console.error(`\n❌ Sync failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
