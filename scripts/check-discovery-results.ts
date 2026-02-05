import { pool } from '../src/config/database.js';

const DISCOVERY_RUN_ID = '1b1fd3d4-ba46-4b75-96b9-937ac6cbfb30'; // Latest discovery run

async function checkDiscoveryResults() {
  try {
    console.log(`Checking discovery run: ${DISCOVERY_RUN_ID}\n`);

    // Check discovery run status
    const runResult = await pool.query(`
      SELECT id, status, created_at, completed_at, cost_estimates
      FROM discovery_runs
      WHERE id = $1
    `, [DISCOVERY_RUN_ID]);

    if (runResult.rows.length === 0) {
      console.log('❌ Discovery run not found');
      return;
    }

    const run = runResult.rows[0];
    console.log('Discovery Run Status:');
    console.log(`  ID: ${run.id}`);
    console.log(`  Status: ${run.status}`);
    console.log(`  Created: ${run.created_at}`);
    console.log(`  Completed: ${run.completed_at || 'Not completed'}`);
    if (run.cost_estimates) {
      console.log(`  Cost Estimates:`, JSON.stringify(run.cost_estimates, null, 2));
    }
    console.log('');

    // Check businesses created for this discovery run
    const businessesResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM businesses
      WHERE discovery_run_id = $1
    `, [DISCOVERY_RUN_ID]);

    const businessCount = parseInt(businessesResult.rows[0].count, 10);
    console.log(`Businesses created: ${businessCount}`);

    if (businessCount > 0) {
      // Get sample businesses
      const sampleResult = await pool.query(`
        SELECT id, name, normalized_name, city_id, industry_id, dataset_id, google_place_id
        FROM businesses
        WHERE discovery_run_id = $1
        LIMIT 5
      `, [DISCOVERY_RUN_ID]);

      console.log('\nSample businesses:');
      sampleResult.rows.forEach((b, i) => {
        console.log(`  ${i + 1}. ${b.name} (${b.normalized_name})`);
        console.log(`     ID: ${b.id}`);
        console.log(`     Google Place ID: ${b.google_place_id || 'N/A'}`);
      });
    } else {
      console.log('\n⚠️  No businesses found for this discovery run');
      console.log('   This could mean:');
      console.log('   - Discovery is still running');
      console.log('   - Discovery failed silently');
      console.log('   - No businesses were found');
    }

    // Check for any recent errors in businesses table
    const recentErrors = await pool.query(`
      SELECT COUNT(*) as count
      FROM businesses
      WHERE created_at > NOW() - INTERVAL '5 minutes'
        AND (name IS NULL OR normalized_name IS NULL)
    `);

    console.log(`\nRecent invalid businesses (NULL name/normalized_name): ${recentErrors.rows[0].count}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking discovery results:', error);
    process.exit(1);
  }
}

checkDiscoveryResults();
