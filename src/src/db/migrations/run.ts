import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

// Load environment variables FIRST before importing database config
dotenv.config();

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  // Create a new pool for migration (don't use the shared one)
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 
      `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    // Verify connection string is set
    if (!process.env.DATABASE_URL && (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_HOST)) {
      throw new Error('Database connection not configured. Please set DATABASE_URL or DB_* environment variables in .env file');
    }

    // Get migration file from command line args or default
    const migrationFile = process.argv[2] || 'create_crawl_results.sql';
    const sql = readFileSync(join(__dirname, migrationFile), 'utf-8');
    
    console.log(`Running migration: ${migrationFile}`);
    await pool.query(sql);
    
    console.log('✓ Migration completed successfully');
    await pool.end();
  } catch (error) {
    console.error('✗ Migration failed:', error);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
