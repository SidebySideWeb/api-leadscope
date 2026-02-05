import { pool } from '../src/config/database.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function createSupabaseMigrations() {
  try {
    console.log('Creating supabase_migrations schema and table...');
    
    const sqlPath = join(__dirname, '../src/db/migrations/create_supabase_migrations_schema.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    
    await pool.query(sql);
    
    console.log('✅ Created supabase_migrations schema and table');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to create supabase_migrations:', error);
    process.exit(1);
  }
}

createSupabaseMigrations();
