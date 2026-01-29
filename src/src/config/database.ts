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

export async function testConnection(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('Database connection successful:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}
