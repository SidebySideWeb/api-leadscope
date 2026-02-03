import * as pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Build connection string
function getConnectionString(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Fallback to individual components
  const user = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || '';
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const database = process.env.DB_NAME || 'postgres';

  if (!password && !process.env.DATABASE_URL) {
    throw new Error(
      'Database connection not configured. Please set DATABASE_URL or DB_* environment variables in .env file.\n' +
      'See .env.example for reference.'
    );
  }

  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

export const pool = new Pool({
  connectionString: getConnectionString(),
  ssl: {
    rejectUnauthorized: false
  },
  // Add connection timeout and retry options
  connectionTimeoutMillis: 10000, // 10 second timeout
  idleTimeoutMillis: 30000,
  max: 20, // Maximum pool size
});

// Add error handlers for connection pool
pool.on('error', (err, client) => {
  console.error('[DATABASE] Unexpected error on idle client:', {
    error_code: err.code,
    error_message: err.message,
    error_detail: (err as any).detail,
    error_hint: (err as any).hint,
    stack: err.stack
  });
});

pool.on('connect', (client) => {
  console.log('[DATABASE] New client connected to database');
});

pool.on('acquire', (client) => {
  console.log('[DATABASE] Client acquired from pool');
});

pool.on('remove', (client) => {
  console.log('[DATABASE] Client removed from pool');
});

export async function testConnection(): Promise<boolean> {
  try {
    console.log('[DATABASE] Testing database connection...');
    const result = await pool.query('SELECT NOW(), current_user, current_database()');
    console.log('[DATABASE] Connection successful:', {
      timestamp: result.rows[0].now,
      user: result.rows[0].current_user,
      database: result.rows[0].current_database()
    });
    
    // Test RLS is enabled on key tables
    const rlsCheck = await pool.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename IN ('contacts', 'contact_sources', 'websites', 'businesses', 'extraction_jobs')
      ORDER BY tablename
    `);
    
    console.log('[DATABASE] RLS Status on key tables:');
    rlsCheck.rows.forEach(row => {
      console.log(`[DATABASE]   ${row.tablename}: RLS ${row.rowsecurity ? 'ENABLED' : 'DISABLED'}`);
    });
    
    return true;
  } catch (error: any) {
    console.error('[DATABASE] Connection test failed:', {
      error_code: error.code,
      error_message: error.message,
      error_detail: error.detail,
      error_hint: error.hint,
      stack: error.stack
    });
    return false;
  }
}
