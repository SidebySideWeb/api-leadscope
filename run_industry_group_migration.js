/**
 * Quick script to run the industry_group_id migration
 * 
 * Usage: node run_industry_group_migration.js
 * 
 * Make sure your DATABASE_URL environment variable is set
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from './src/config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  try {
    const migrationPath = join(__dirname, 'src', 'db', 'migrations', 'add_industry_group_id_to_discovery_runs.sql');
    const sql = readFileSync(migrationPath, 'utf-8');
    
    console.log('Running migration: add_industry_group_id_to_discovery_runs.sql');
    console.log('SQL:', sql);
    
    await pool.query(sql);
    
    console.log('✅ Migration completed successfully!');
    console.log('The industry_group_id column has been added to discovery_runs table.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
