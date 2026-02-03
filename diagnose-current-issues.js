#!/usr/bin/env node

/**
 * Diagnostic script to check what's broken compared to 29/01 successful runs
 * Run: node diagnose-current-issues.js
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

async function diagnose() {
  try {
    console.log('🔍 Diagnosing Current Issues...\n');
    console.log('Comparing to successful runs on 29/01\n');

    // 1. Check recent discovery runs
    console.log('1. Recent Discovery Runs (last 10):');
    const recentRuns = await pool.query(`
      SELECT 
        id,
        status,
        created_at,
        started_at,
        completed_at,
        error_message
      FROM discovery_runs
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    recentRuns.rows.forEach((run, idx) => {
      console.log(`   ${idx + 1}. ${run.id.substring(0, 8)}... - ${run.status} - Created: ${run.created_at}`);
      if (run.error_message) {
        console.log(`      Error: ${run.error_message}`);
      }
    });
    console.log('');

    // 2. Check businesses from recent runs
    console.log('2. Businesses from Recent Discovery Runs:');
    const recentBusinesses = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT discovery_run_id) as runs_with_businesses
      FROM businesses
      WHERE discovery_run_id IS NOT NULL
        AND created_at >= NOW() - INTERVAL '7 days'
    `);
    console.log(`   Total businesses (last 7 days): ${recentBusinesses.rows[0].total}`);
    console.log(`   Discovery runs with businesses: ${recentBusinesses.rows[0].runs_with_businesses}\n`);

    // 3. Check extraction jobs
    console.log('3. Extraction Jobs Status:');
    const extractionStatus = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'success') as success,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM extraction_jobs
    `);
    console.log(`   Total: ${extractionStatus.rows[0].total}`);
    console.log(`   Pending: ${extractionStatus.rows[0].pending}`);
    console.log(`   Running: ${extractionStatus.rows[0].running}`);
    console.log(`   Success: ${extractionStatus.rows[0].success}`);
    console.log(`   Failed: ${extractionStatus.rows[0].failed}\n`);

    // 4. Check businesses without extraction jobs
    console.log('4. Businesses Missing Extraction Jobs:');
    const missingJobs = await pool.query(`
      SELECT COUNT(*) as count
      FROM businesses b
      LEFT JOIN extraction_jobs ej ON ej.business_id = b.id
      WHERE ej.id IS NULL
        AND b.discovery_run_id IS NOT NULL
        AND b.created_at >= NOW() - INTERVAL '7 days'
    `);
    console.log(`   Businesses without extraction jobs: ${missingJobs.rows[0].count}\n`);

    // 5. Check websites
    console.log('5. Websites Status:');
    const websites = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT business_id) as businesses_with_websites
      FROM websites
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);
    console.log(`   Total websites (last 7 days): ${websites.rows[0].total}`);
    console.log(`   Businesses with websites: ${websites.rows[0].businesses_with_websites}\n`);

    // 6. Check contacts
    console.log('6. Contacts Status:');
    const contacts = await pool.query(`
      SELECT 
        COUNT(*) as total_contacts,
        COUNT(DISTINCT contact_id) as unique_contacts,
        COUNT(*) FILTER (WHERE contact_type = 'email') as emails,
        COUNT(*) FILTER (WHERE contact_type = 'phone') as phones
      FROM contact_sources
      WHERE found_at >= NOW() - INTERVAL '7 days'
    `);
    console.log(`   Total contact sources (last 7 days): ${contacts.rows[0].total_contacts}`);
    console.log(`   Unique contacts: ${contacts.rows[0].unique_contacts}`);
    console.log(`   Emails: ${contacts.rows[0].emails}`);
    console.log(`   Phones: ${contacts.rows[0].phones}\n`);

    // 7. Check contact_sources business_id linking
    console.log('7. Contact Sources Business Linking:');
    const contactLinking = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(business_id) as with_business_id,
        COUNT(*) - COUNT(business_id) as without_business_id
      FROM contact_sources
      WHERE found_at >= NOW() - INTERVAL '7 days'
    `);
    console.log(`   Total (last 7 days): ${contactLinking.rows[0].total}`);
    console.log(`   With business_id: ${contactLinking.rows[0].with_business_id}`);
    console.log(`   Without business_id: ${contactLinking.rows[0].without_business_id}\n`);

    // 8. Check recent failed extraction jobs
    console.log('8. Recent Failed Extraction Jobs (last 10):');
    const failedJobs = await pool.query(`
      SELECT 
        ej.id,
        ej.business_id,
        ej.status,
        ej.error_message,
        ej.created_at,
        b.name as business_name
      FROM extraction_jobs ej
      LEFT JOIN businesses b ON b.id = ej.business_id
      WHERE ej.status = 'failed'
        AND ej.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY ej.created_at DESC
      LIMIT 10
    `);
    
    if (failedJobs.rows.length > 0) {
      failedJobs.rows.forEach((job, idx) => {
        console.log(`   ${idx + 1}. Business: ${job.business_name || job.business_id}`);
        console.log(`      Error: ${job.error_message || 'No error message'}`);
        console.log(`      Created: ${job.created_at}`);
      });
    } else {
      console.log('   No failed extraction jobs found');
    }
    console.log('');

    // 9. Check exports
    console.log('9. Recent Exports (last 10):');
    const exports = await pool.query(`
      SELECT 
        id,
        export_type,
        total_rows,
        file_format,
        file_path,
        created_at
      FROM exports
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    if (exports.rows.length > 0) {
      exports.rows.forEach((exp, idx) => {
        console.log(`   ${idx + 1}. ${exp.export_type} - ${exp.total_rows} rows - ${exp.file_format}`);
        console.log(`      Path: ${exp.file_path}`);
        console.log(`      Created: ${exp.created_at}`);
      });
    } else {
      console.log('   No exports found');
    }
    console.log('');

    // 10. Summary and recommendations
    console.log('========================================');
    console.log('SUMMARY & RECOMMENDATIONS');
    console.log('========================================\n');

    const pendingJobs = parseInt(extractionStatus.rows[0].pending || '0');
    const missingJobsCount = parseInt(missingJobs.rows[0].count || '0');
    const failedJobsCount = parseInt(extractionStatus.rows[0].failed || '0');

    if (missingJobsCount > 0) {
      console.log(`⚠️  ISSUE: ${missingJobsCount} businesses don't have extraction jobs`);
      console.log('   → Extraction jobs should be created automatically during discovery');
      console.log('   → Check discovery worker logs for errors\n');
    }

    if (pendingJobs > 0) {
      console.log(`⚠️  ISSUE: ${pendingJobs} extraction jobs are pending`);
      console.log('   → Extraction worker should process these automatically');
      console.log('   → Check if extraction worker is running\n');
    }

    if (failedJobsCount > 0) {
      console.log(`⚠️  ISSUE: ${failedJobsCount} extraction jobs failed`);
      console.log('   → Check error messages above to identify the problem');
      console.log('   → Common issues: RLS policies, missing columns, type mismatches\n');
    }

    const recentBusinessesCount = parseInt(recentBusinesses.rows[0].total || '0');
    const websitesCount = parseInt(websites.rows[0].total || '0');
    
    if (recentBusinessesCount > 0 && websitesCount === 0) {
      console.log(`⚠️  ISSUE: ${recentBusinessesCount} businesses found but 0 websites`);
      console.log('   → Extraction worker should create websites');
      console.log('   → Check extraction worker logs\n');
    }

    const contactsCount = parseInt(contacts.rows[0].total_contacts || '0');
    if (recentBusinessesCount > 0 && contactsCount === 0) {
      console.log(`⚠️  ISSUE: ${recentBusinessesCount} businesses found but 0 contacts`);
      console.log('   → Extraction worker should extract contacts');
      console.log('   → Check extraction worker logs\n');
    }

    if (missingJobsCount === 0 && pendingJobs === 0 && failedJobsCount === 0 && websitesCount > 0 && contactsCount > 0) {
      console.log('✅ Everything looks good!');
      console.log('   → Discovery is working');
      console.log('   → Extraction jobs are being created');
      console.log('   → Extraction worker is processing jobs');
      console.log('   → Websites and contacts are being created\n');
    }

    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

diagnose();
