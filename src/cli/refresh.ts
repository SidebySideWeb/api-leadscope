import dotenv from 'dotenv';
import { testConnection } from '../config/database.js';
import { runRefreshJob } from '../services/refreshService.js';
import type { RefreshJobInput } from '../types/jobs.js';

dotenv.config();

async function main() {
  // Test database connection
  const connected = await testConnection();
  if (!connected) {
    console.error('Failed to connect to database. Exiting.');
    process.exit(1);
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  const batchSize = args[0] ? parseInt(args[0], 10) : 50;
  const maxAgeDays = args[1] ? parseInt(args[1], 10) : 30;

  const input: RefreshJobInput = {
    batchSize,
    maxAgeDays
  };

  console.log('Starting refresh job...');
  console.log('Input:', JSON.stringify(input, null, 2));

  try {
    const result = await runRefreshJob(input);
    
    console.log('\nRefresh job completed:');
    console.log(`  Job ID: ${result.jobId}`);
    console.log(`  Duration: ${(result.endTime.getTime() - result.startTime.getTime()) / 1000}s`);
    console.log(`  Websites processed: ${result.totalWebsitesProcessed}`);
    console.log(`  Contacts added: ${result.contactsAdded}`);
    console.log(`  Contacts verified: ${result.contactsVerified}`);
    console.log(`  Contacts deactivated: ${result.contactsRemoved}`);
    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
      result.errors.forEach(err => console.error(`    - ${err}`));
    }
  } catch (error) {
    console.error('Refresh job failed:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
