// Quick database connection test
import * as dotenv from 'dotenv';
import * as pg from 'pg';

dotenv.config();
const { Pool } = pg;

console.log('Testing database connection...');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@') : 'NOT SET');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000, // 10 second timeout
});

pool.query('SELECT NOW() as current_time, version() as pg_version')
  .then(result => {
    console.log('\n✅ Connection successful!');
    console.log('Current time:', result.rows[0].current_time);
    console.log('PostgreSQL version:', result.rows[0].pg_version.split(' ')[0] + ' ' + result.rows[0].pg_version.split(' ')[1]);
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Connection failed!');
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    
    if (error.code === 'ENOTFOUND') {
      console.error('\n🔍 DNS Resolution Failed');
      console.error('The hostname cannot be resolved. Possible causes:');
      console.error('1. Supabase project is paused (check dashboard)');
      console.error('2. Incorrect hostname in DATABASE_URL');
      console.error('3. Network/DNS issue');
      console.error('4. Firewall blocking DNS queries');
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      console.error('\n🔍 Connection Timeout/Refused');
      console.error('Cannot reach the database server. Possible causes:');
      console.error('1. Firewall blocking port 5432');
      console.error('2. Supabase project is paused');
      console.error('3. Network connectivity issue');
    }
    
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });
