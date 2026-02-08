/**
 * Check running jobs that might be making Google Places API calls
 * This helps identify what's causing excessive API costs
 */

import dotenv from 'dotenv';
import { pool } from '../src/config/database.js';

dotenv.config();

async function checkRunningJobs() {
  console.log('🔍 Checking running jobs that might be making Google Places API calls...\n');

  try {
    // Check extraction jobs (these call getPlaceDetails)
    const extractionJobs = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'success') as success,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM extraction_jobs
    `);

    const extStats = extractionJobs.rows[0];
    console.log('📊 EXTRACTION JOBS (calls getPlaceDetails API):');
    console.log(`   Total: ${extStats.total}`);
    console.log(`   ⚠️  Pending: ${extStats.pending} (will call API)`);
    console.log(`   ⚠️  Running: ${extStats.running} (calling API now)`);
    console.log(`   ✅ Success: ${extStats.success}`);
    console.log(`   ❌ Failed: ${extStats.failed}`);

    // Check crawl jobs (these might trigger extraction jobs)
    const crawlJobs = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM crawl_jobs
    `);

    const crawlStats = crawlJobs.rows[0];
    console.log('\n📊 CRAWL JOBS (may trigger extraction → Place Details):');
    console.log(`   Total: ${crawlStats.total}`);
    console.log(`   ⚠️  Pending: ${crawlStats.pending}`);
    console.log(`   ⚠️  Running: ${crawlStats.running}`);
    console.log(`   ✅ Completed: ${crawlStats.completed}`);
    console.log(`   ❌ Failed: ${crawlStats.failed}`);

    // Check discovery runs (these call searchPlaces API)
    const discoveryRuns = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM discovery_runs
    `);

    const discStats = discoveryRuns.rows[0];
    console.log('\n📊 DISCOVERY RUNS (calls searchPlaces API):');
    console.log(`   Total: ${discStats.total}`);
    console.log(`   ⚠️  Pending: ${discStats.pending} (will call API)`);
    console.log(`   ⚠️  Running: ${discStats.running} (calling API now)`);
    console.log(`   ✅ Completed: ${discStats.completed}`);
    console.log(`   ❌ Failed: ${discStats.failed}`);

    // Get recent extraction jobs that are pending/running
    const recentExtraction = await pool.query(`
      SELECT 
        ej.id,
        ej.business_id,
        ej.status,
        ej.created_at,
        ej.started_at,
        b.name as business_name,
        b.google_place_id
      FROM extraction_jobs ej
      JOIN businesses b ON b.id = ej.business_id
      WHERE ej.status IN ('pending', 'running')
      ORDER BY ej.created_at DESC
      LIMIT 20
    `);

    if (recentExtraction.rows.length > 0) {
      console.log('\n⚠️  RECENT PENDING/RUNNING EXTRACTION JOBS (will call Place Details):');
      recentExtraction.rows.forEach((job, idx) => {
        console.log(`   ${idx + 1}. Business: ${job.business_name} (ID: ${job.business_id})`);
        console.log(`      Status: ${job.status}, Created: ${job.created_at}`);
        console.log(`      Place ID: ${job.google_place_id || 'NONE'}`);
      });
    }

    // Get recent discovery runs
    const recentDiscovery = await pool.query(`
      SELECT 
        dr.id,
        dr.status,
        dr.created_at,
        dr.started_at,
        dr.searches_executed,
        d.name as dataset_name
      FROM discovery_runs dr
      JOIN datasets d ON d.id = dr.dataset_id
      WHERE dr.status IN ('pending', 'running')
      ORDER BY dr.created_at DESC
      LIMIT 10
    `);

    if (recentDiscovery.rows.length > 0) {
      console.log('\n⚠️  RECENT PENDING/RUNNING DISCOVERY RUNS (will call searchPlaces):');
      recentDiscovery.rows.forEach((run, idx) => {
        console.log(`   ${idx + 1}. Dataset: ${run.dataset_name}`);
        console.log(`      Status: ${run.status}, Created: ${run.created_at}`);
        console.log(`      Searches executed: ${run.searches_executed || 0}`);
      });
    }

    // Calculate potential API cost
    const pendingExtraction = parseInt(extStats.pending) + parseInt(extStats.running);
    const runningDiscovery = parseInt(discStats.pending) + parseInt(discStats.running);
    
    console.log('\n💰 ESTIMATED API COSTS:');
    console.log(`   Place Details calls (extraction): ${pendingExtraction} × $0.017 = $${(pendingExtraction * 0.017).toFixed(2)}`);
    console.log(`   Search calls (discovery): ${runningDiscovery} × $0.032 = $${(runningDiscovery * 0.032).toFixed(2)}`);
    console.log(`   ⚠️  TOTAL POTENTIAL COST: $${((pendingExtraction * 0.017) + (runningDiscovery * 0.032)).toFixed(2)}`);

  } catch (error: any) {
    console.error('❌ Error checking jobs:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

checkRunningJobs();
