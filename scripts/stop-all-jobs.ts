/**
 * EMERGENCY: Stop all running jobs to prevent further Google Places API costs
 * This will mark all pending/running jobs as failed to stop processing
 */

import dotenv from 'dotenv';
import { pool } from '../src/config/database.js';

dotenv.config();

async function stopAllJobs() {
  console.log('🛑 EMERGENCY STOP: Stopping all running jobs to prevent API costs...\n');

  try {
    // Stop extraction jobs
    const stopExtraction = await pool.query(`
      UPDATE extraction_jobs
      SET 
        status = 'failed',
        error_message = 'Stopped manually to prevent API costs',
        completed_at = NOW()
      WHERE status IN ('pending', 'running')
      RETURNING id, business_id, status
    `);

    console.log(`✅ Stopped ${stopExtraction.rows.length} extraction jobs`);

    // Stop crawl jobs
    const stopCrawl = await pool.query(`
      UPDATE crawl_jobs
      SET 
        status = 'failed',
        error_message = 'Stopped manually to prevent API costs',
        completed_at = NOW()
      WHERE status IN ('pending', 'running')
      RETURNING id, website_id, status
    `);

    console.log(`✅ Stopped ${stopCrawl.rows.length} crawl jobs`);

    // Stop discovery runs
    const stopDiscovery = await pool.query(`
      UPDATE discovery_runs
      SET 
        status = 'failed',
        error_message = 'Stopped manually to prevent API costs',
        completed_at = NOW()
      WHERE status IN ('pending', 'running')
      RETURNING id, dataset_id, status
    `);

    console.log(`✅ Stopped ${stopDiscovery.rows.length} discovery runs`);

    console.log('\n✅ All jobs stopped successfully!');
    console.log('⚠️  Note: Workers may still process jobs that were already started.');
    console.log('   Consider restarting workers to ensure they stop processing.');

  } catch (error: any) {
    console.error('❌ Error stopping jobs:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

// Confirm before stopping
const args = process.argv.slice(2);
if (args.includes('--confirm')) {
  stopAllJobs();
} else {
  console.log('⚠️  WARNING: This will stop ALL pending/running jobs!');
  console.log('   Run with --confirm flag to proceed:');
  console.log('   tsx scripts/stop-all-jobs.ts --confirm');
  process.exit(1);
}
