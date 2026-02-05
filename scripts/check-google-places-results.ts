import { pool } from '../src/config/database.js';

const DATASET_ID = '895d7197-e5be-455f-ab6b-5bfa9ef1d6a7';

async function checkGooglePlacesResults() {
  try {
    console.log(`Checking Google Places results for dataset: ${DATASET_ID}\n`);
    console.log('='.repeat(80));

    // Get discovery runs for this dataset
    const runsResult = await pool.query(`
      SELECT id, status, created_at, completed_at, cost_estimates
      FROM discovery_runs
      WHERE dataset_id = $1
      ORDER BY created_at DESC
      LIMIT 5
    `, [DATASET_ID]);

    console.log(`🔍 Discovery Runs: ${runsResult.rows.length}\n`);

    for (const run of runsResult.rows) {
      console.log(`Run ID: ${run.id}`);
      console.log(`  Status: ${run.status}`);
      console.log(`  Created: ${run.created_at}`);
      console.log(`  Completed: ${run.completed_at || 'Not completed'}`);

      if (run.cost_estimates) {
        const estimates = run.cost_estimates as any;
        console.log(`  Cost Estimates:`);
        console.log(`    Estimated Businesses: ${estimates.estimatedBusinesses || 0}`);
        if (estimates.completenessStats) {
          console.log(`    Completeness:`);
          console.log(`      With Website: ${estimates.completenessStats.withWebsitePercent || 0}%`);
          console.log(`      With Email: ${estimates.completenessStats.withEmailPercent || 0}%`);
          console.log(`      With Phone: ${estimates.completenessStats.withPhonePercent || 0}%`);
        }
      }

      // Count businesses created by this discovery run
      const businessesCount = await pool.query(`
        SELECT COUNT(*) as count
        FROM businesses
        WHERE discovery_run_id = $1
      `, [run.id]);

      const count = parseInt(businessesCount.rows[0].count, 10);
      console.log(`  Businesses Created in DB: ${count}`);

      // Get sample businesses
      if (count > 0) {
        const sampleResult = await pool.query(`
          SELECT name, google_place_id, address
          FROM businesses
          WHERE discovery_run_id = $1
          ORDER BY created_at DESC
          LIMIT 5
        `, [run.id]);

        console.log(`  Sample Businesses:`);
        sampleResult.rows.forEach((b, i) => {
          console.log(`    ${i + 1}. ${b.name}`);
          console.log(`       Place ID: ${b.google_place_id}`);
        });
      }

      console.log('');
    }

    // Check total businesses for this dataset
    const datasetBusinessesCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM dataset_businesses
      WHERE dataset_id = $1
    `, [DATASET_ID]);

    console.log(`\n📊 Total Businesses Linked to Dataset: ${parseInt(datasetBusinessesCount.rows[0].count, 10)}`);

    // Get dataset info
    const datasetResult = await pool.query(`
      SELECT city_id, industry_id
      FROM datasets
      WHERE id = $1
    `, [DATASET_ID]);

    if (datasetResult.rows.length > 0) {
      const dataset = datasetResult.rows[0];
      
      // Count all businesses for this city+industry (regardless of dataset)
      const allBusinessesCount = await pool.query(`
        SELECT COUNT(*) as count
        FROM businesses
        WHERE city_id = $1 AND industry_id = $2
      `, [dataset.city_id, dataset.industry_id]);

      console.log(`\n🌍 Total Businesses for City+Industry: ${parseInt(allBusinessesCount.rows[0].count, 10)}`);
      console.log(`   (This includes businesses from all datasets)`);
    }

    console.log('\n💡 Note: The "Estimated Businesses" from cost_estimates shows how many');
    console.log('   businesses Google Places API returned during discovery.');
    console.log('   The "Businesses Created in DB" shows how many were actually inserted.');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkGooglePlacesResults();
