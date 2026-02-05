import { pool } from '../src/config/database.js';

async function checkDiscoveryErrors() {
  try {
    console.log('Checking for discovery errors...\n');

    // Get recent discovery runs
    const runsResult = await pool.query(`
      SELECT 
        id,
        status,
        created_at,
        completed_at,
        cost_estimates
      FROM discovery_runs
      ORDER BY created_at DESC
      LIMIT 5
    `);

    console.log('Recent Discovery Runs:');
    console.log('='.repeat(80));
    
    for (const run of runsResult.rows) {
      console.log(`\nRun ID: ${run.id}`);
      console.log(`  Status: ${run.status}`);
      console.log(`  Created: ${run.created_at}`);
      console.log(`  Completed: ${run.completed_at || 'Not completed'}`);
      
      // Count businesses for this run
      const bizCount = await pool.query(`
        SELECT COUNT(*) as count
        FROM businesses
        WHERE discovery_run_id = $1
      `, [run.id]);
      
      const count = parseInt(bizCount.rows[0].count, 10);
      console.log(`  Businesses created: ${count}`);
      
      if (run.cost_estimates) {
        const estimates = run.cost_estimates as any;
        console.log(`  Estimated businesses: ${estimates.estimatedBusinesses || 0}`);
      }
    }

    // Check for any database errors by looking at recent failed inserts
    // (We can't query logs, but we can check if businesses exist)
    console.log('\n' + '='.repeat(80));
    console.log('\nChecking for businesses without discovery_run_id (might indicate errors):');
    
    const orphanedBiz = await pool.query(`
      SELECT COUNT(*) as count
      FROM businesses
      WHERE discovery_run_id IS NULL
        AND created_at > NOW() - INTERVAL '10 minutes'
    `);
    
    console.log(`  Recent businesses without discovery_run_id: ${orphanedBiz.rows[0].count}`);

    // Check for businesses with NULL normalized_name (should never happen now)
    const nullNormalized = await pool.query(`
      SELECT COUNT(*) as count
      FROM businesses
      WHERE normalized_name IS NULL
        AND created_at > NOW() - INTERVAL '10 minutes'
    `);
    
    console.log(`  Recent businesses with NULL normalized_name: ${nullNormalized.rows[0].count}`);

    console.log('\n✅ Check complete');
    console.log('\nTo see detailed logs, check the terminal where you ran "npm start"');
    console.log('Look for:');
    console.log('  - [discoverBusinessesV2] logs');
    console.log('  - [upsertBusinessGlobal] DATABASE INSERT ERROR');
    console.log('  - [discoverBusinessesV2] FATAL insert error');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking discovery errors:', error);
    process.exit(1);
  }
}

checkDiscoveryErrors();
