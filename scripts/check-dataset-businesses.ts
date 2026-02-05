import { pool } from '../src/config/database.js';

const DATASET_ID = '895d7197-e5be-455f-ab6b-5bfa9ef1d6a7';

async function checkDatasetBusinesses() {
  try {
    console.log(`Checking dataset: ${DATASET_ID}\n`);
    console.log('='.repeat(80));

    // Get dataset info
    const datasetResult = await pool.query(`
      SELECT id, name, city_id, industry_id, last_refreshed_at, created_at
      FROM datasets
      WHERE id = $1
    `, [DATASET_ID]);

    if (datasetResult.rows.length === 0) {
      console.error('❌ Dataset not found');
      return;
    }

    const dataset = datasetResult.rows[0];
    console.log('📋 Dataset Info:');
    console.log(`  ID: ${dataset.id}`);
    console.log(`  Name: ${dataset.name}`);
    console.log(`  City ID: ${dataset.city_id}`);
    console.log(`  Industry ID: ${dataset.industry_id}`);
    console.log(`  Created: ${dataset.created_at}`);
    console.log(`  Last Refreshed: ${dataset.last_refreshed_at || 'Never'}`);
    console.log('');

    // Count businesses linked to this dataset
    const businessesCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM dataset_businesses
      WHERE dataset_id = $1
    `, [DATASET_ID]);

    const count = parseInt(businessesCount.rows[0].count, 10);
    console.log(`🔗 Businesses linked to dataset: ${count}`);

    // Get sample businesses
    if (count > 0) {
      const businessesResult = await pool.query(`
        SELECT b.id, b.name, b.address, b.google_place_id, b.discovery_run_id
        FROM businesses b
        INNER JOIN dataset_businesses db ON db.business_id = b.id
        WHERE db.dataset_id = $1
        ORDER BY b.created_at DESC
        LIMIT 10
      `, [DATASET_ID]);

      console.log('\n📊 Sample Businesses:');
      businessesResult.rows.forEach((b, i) => {
        console.log(`  ${i + 1}. ${b.name}`);
        console.log(`     Address: ${b.address || 'N/A'}`);
        console.log(`     Google Place ID: ${b.google_place_id || 'N/A'}`);
        console.log(`     Discovery Run: ${b.discovery_run_id || 'N/A'}`);
        console.log('');
      });
    }

    // Check discovery runs for this dataset
    const discoveryRunsResult = await pool.query(`
      SELECT id, status, created_at, completed_at, cost_estimates
      FROM discovery_runs
      WHERE dataset_id = $1
      ORDER BY created_at DESC
      LIMIT 5
    `, [DATASET_ID]);

    console.log(`\n🔍 Discovery Runs: ${discoveryRunsResult.rows.length}`);
    for (let i = 0; i < discoveryRunsResult.rows.length; i++) {
      const run = discoveryRunsResult.rows[i];
      console.log(`\n  Run ${i + 1}:`);
      console.log(`    ID: ${run.id}`);
      console.log(`    Status: ${run.status}`);
      console.log(`    Created: ${run.created_at}`);
      console.log(`    Completed: ${run.completed_at || 'Not completed'}`);
      
      if (run.cost_estimates) {
        const estimates = run.cost_estimates as any;
        console.log(`    Estimated Businesses: ${estimates.estimatedBusinesses || 0}`);
      }

      // Count businesses created by this discovery run
      const runBusinessesCount = await pool.query(`
        SELECT COUNT(*) as count
        FROM businesses
        WHERE discovery_run_id = $1
      `, [run.id]);

      console.log(`    Businesses Created: ${parseInt(runBusinessesCount.rows[0].count, 10)}`);
    }

    // Check for businesses with this city_id and industry_id (regardless of dataset)
    const allBusinessesResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM businesses
      WHERE city_id = $1 AND industry_id = $2
    `, [dataset.city_id, dataset.industry_id]);

    console.log(`\n🌍 Total businesses for this city+industry: ${parseInt(allBusinessesResult.rows[0].count, 10)}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkDatasetBusinesses();
