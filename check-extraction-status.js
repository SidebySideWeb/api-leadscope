#!/usr/bin/env node

/**
 * Diagnostic script to check extraction job status
 * Run: node check-extraction-status.js
 */

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 
    `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  ssl: {
    rejectUnauthorized: false
  }
});

async function checkStatus() {
  try {
    console.log('🔍 Checking Extraction Status...\n');

    // 1. Check discovery runs
    const discoveryRuns = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM discovery_runs
    `);
    console.log('📊 Discovery Runs:');
    console.log(`   Total: ${discoveryRuns.rows[0].total}`);
    console.log(`   Running: ${discoveryRuns.rows[0].running}`);
    console.log(`   Completed: ${discoveryRuns.rows[0].completed}`);
    console.log(`   Failed: ${discoveryRuns.rows[0].failed}\n`);

    // 2. Check businesses
    const businesses = await pool.query(`
      SELECT COUNT(*) as total FROM businesses
    `);
    console.log(`📦 Businesses: ${businesses.rows[0].total}\n`);

    // 3. Check extraction jobs
    const extractionJobs = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'success') as success,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM extraction_jobs
    `);
    console.log('⚙️  Extraction Jobs:');
    console.log(`   Total: ${extractionJobs.rows[0].total}`);
    console.log(`   Pending: ${extractionJobs.rows[0].pending}`);
    console.log(`   Running: ${extractionJobs.rows[0].running}`);
    console.log(`   Success: ${extractionJobs.rows[0].success}`);
    console.log(`   Failed: ${extractionJobs.rows[0].failed}\n`);

    // 4. Check if businesses have extraction jobs
    const businessesWithoutJobs = await pool.query(`
      SELECT COUNT(*) as count
      FROM businesses b
      LEFT JOIN extraction_jobs ej ON ej.business_id = b.id
      WHERE ej.id IS NULL
    `);
    console.log(`⚠️  Businesses WITHOUT extraction jobs: ${businessesWithoutJobs.rows[0].count}\n`);

    // 5. Check websites
    const websites = await pool.query(`SELECT COUNT(*) as total FROM websites`);
    console.log(`🌐 Websites: ${websites.rows[0].total}\n`);

    // 6. Check contacts
    const contacts = await pool.query(`SELECT COUNT(*) as total FROM contacts`);
    console.log(`📧 Contacts: ${contacts.rows[0].total}\n`);

    // 7. Check contact_sources
    const contactSources = await pool.query(`SELECT COUNT(*) as total FROM contact_sources`);
    console.log(`🔗 Contact Sources: ${contactSources.rows[0].total}\n`);

    // 8. Check crawl jobs
    const crawlJobs = await pool.query(`SELECT COUNT(*) as total FROM crawl_jobs`);
    console.log(`🕷️  Crawl Jobs: ${crawlJobs.rows[0].total}\n`);

    // 9. Check recent extraction jobs with errors
    const recentFailed = await pool.query(`
      SELECT ej.id, ej.business_id, ej.status, ej.error_message, ej.created_at
      FROM extraction_jobs ej
      WHERE ej.status = 'failed'
      ORDER BY ej.created_at DESC
      LIMIT 5
    `);
    
    if (recentFailed.rows.length > 0) {
      console.log('❌ Recent Failed Extraction Jobs:');
      recentFailed.rows.forEach(job => {
        console.log(`   Business ID: ${job.business_id}, Error: ${job.error_message || 'No error message'}`);
      });
      console.log('');
    }

    // 10. Check businesses from recent discovery runs
    const recentBusinesses = await pool.query(`
      SELECT 
        b.id,
        b.name,
        b.discovery_run_id,
        ej.id as extraction_job_id,
        ej.status as extraction_status
      FROM businesses b
      LEFT JOIN extraction_jobs ej ON ej.business_id = b.id
      WHERE b.discovery_run_id IS NOT NULL
      ORDER BY b.created_at DESC
      LIMIT 10
    `);

    if (recentBusinesses.rows.length > 0) {
      console.log('📋 Recent Businesses (with extraction job status):');
      recentBusinesses.rows.forEach(b => {
        const jobStatus = b.extraction_job_id 
          ? `✅ Job: ${b.extraction_status}` 
          : '❌ NO JOB';
        console.log(`   ${b.name} (ID: ${b.id}) - ${jobStatus}`);
      });
    }

    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

checkStatus();
