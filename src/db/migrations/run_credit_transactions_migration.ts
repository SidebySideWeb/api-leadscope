/**
 * Run credit_transactions migration
 * 
 * Usage: npm run migrate:credit-transactions
 */

import { pool } from '../../config/database.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  try {
    const filePath = join(__dirname, 'create_credit_transactions.sql');
    const sql = readFileSync(filePath, 'utf-8');
    
    console.log('Running migration: create_credit_transactions.sql');
    await pool.query(sql);
    console.log('✅ Migration completed: create_credit_transactions.sql');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
