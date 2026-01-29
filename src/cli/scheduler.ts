import dotenv from 'dotenv';
import { testConnection } from '../config/database.js';
import { refreshScheduler } from '../scheduler/refreshScheduler.js';

dotenv.config();

async function main() {
  // Test database connection
  const connected = await testConnection();
  if (!connected) {
    console.error('Failed to connect to database. Exiting.');
    process.exit(1);
  }

  console.log('Starting refresh scheduler...');
  console.log('Schedule: 1st of every month at 2:00 AM');
  console.log('Press Ctrl+C to stop\n');

  // Start the scheduler
  refreshScheduler.start({
    batchSize: 50,
    maxAgeDays: 30
  });

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('\nStopping scheduler...');
    refreshScheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nStopping scheduler...');
    refreshScheduler.stop();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
