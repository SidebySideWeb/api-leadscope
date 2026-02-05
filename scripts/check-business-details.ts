import { pool } from '../src/config/database.js';

const DATASET_ID = '895d7197-e5be-455f-ab6b-5bfa9ef1d6a7';
const CITY_ID = 'f7173014-48eb-488e-a8e7-46d4f8c83ef5';
const INDUSTRY_ID = '1dadbd89-37af-470b-a340-ca1c770e236b';

async function checkBusinessDetails() {
  try {
    console.log('Checking businesses...\n');
    console.log('='.repeat(80));

    // Get all businesses for this city+industry
    const businessesResult = await pool.query(`
      SELECT 
        b.id, 
        b.name, 
        b.address, 
        b.google_place_id,
        b.discovery_run_id,
        b.owner_user_id,
        b.dataset_id,
        b.created_at
      FROM businesses b
      WHERE b.city_id = $1 AND b.industry_id = $2
      ORDER BY b.created_at DESC
    `, [CITY_ID, INDUSTRY_ID]);

    console.log(`📊 Total Businesses Found: ${businessesResult.rows.length}\n`);

    businessesResult.rows.forEach((b, i) => {
      console.log(`Business ${i + 1}:`);
      console.log(`  ID: ${b.id}`);
      console.log(`  Name: ${b.name}`);
      console.log(`  Address: ${b.address || 'N/A'}`);
      console.log(`  Google Place ID: ${b.google_place_id || 'N/A'}`);
      console.log(`  Discovery Run ID: ${b.discovery_run_id || 'N/A'}`);
      console.log(`  Owner User ID: ${b.owner_user_id || 'N/A'}`);
      console.log(`  Dataset ID (legacy): ${b.dataset_id || 'N/A'}`);
      console.log(`  Created: ${b.created_at}`);
      console.log('');
    });

    // Check dataset_businesses links
    const linksResult = await pool.query(`
      SELECT db.business_id, db.dataset_id, b.name
      FROM dataset_businesses db
      INNER JOIN businesses b ON b.id = db.business_id
      WHERE db.dataset_id = $1
    `, [DATASET_ID]);

    console.log(`\n🔗 Dataset-Business Links: ${linksResult.rows.length}`);
    linksResult.rows.forEach((link, i) => {
      console.log(`  ${i + 1}. Business: ${link.name} (${link.business_id})`);
    });

    // Check discovery runs
    const runsResult = await pool.query(`
      SELECT id, status, created_at, completed_at
      FROM discovery_runs
      WHERE dataset_id = $1
      ORDER BY created_at DESC
    `, [DATASET_ID]);

    console.log(`\n🔍 Discovery Runs: ${runsResult.rows.length}`);
    for (const run of runsResult.rows) {
      const businessesCount = await pool.query(`
        SELECT COUNT(*) as count
        FROM businesses
        WHERE discovery_run_id = $1
      `, [run.id]);

      console.log(`\n  Run: ${run.id}`);
      console.log(`    Status: ${run.status}`);
      console.log(`    Created: ${run.created_at}`);
      console.log(`    Completed: ${run.completed_at || 'Not completed'}`);
      console.log(`    Businesses with this discovery_run_id: ${parseInt(businessesCount.rows[0].count, 10)}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkBusinessDetails();
