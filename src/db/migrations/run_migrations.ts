/**
 * Run database migrations
 * 
 * Usage: npm run migrate
 */

import { pool } from '../../config/database.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration(filename: string): Promise<void> {
  const filePath = join(__dirname, filename);
  const sql = readFileSync(filePath, 'utf-8');
  
  console.log(`Running migration: ${filename}`);
  await pool.query(sql);
  console.log(`✅ Migration completed: ${filename}`);
}

async function main() {
  const migrations = [
    'create_vrisko_discovery_jobs.sql',
    'create_credit_transactions.sql',
  ];

  try {
    for (const migration of migrations) {
      await runMigration(migration);
    }
    console.log('\n✅ All migrations completed successfully');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
