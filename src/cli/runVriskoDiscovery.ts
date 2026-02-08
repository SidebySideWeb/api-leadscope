/**
 * CLI tool to run Vrisko discovery for a dataset
 * 
 * Usage: npm run discover:vrisko <dataset_id>
 */

import dotenv from 'dotenv';
import { runVriskoDiscovery } from '../discovery/vriskoWorker.js';
import { Logger } from '../crawler/vrisko/utils/logger.js';

dotenv.config();

const logger = new Logger('VriskoDiscoveryCLI');

async function main() {
  const args = process.argv.slice(2);
  const datasetId = args[0];

  if (!datasetId) {
    console.error('Usage: npm run discover:vrisko <dataset_id>');
    process.exit(1);
  }

  console.log(`\n🔍 Starting Vrisko discovery for dataset: ${datasetId}\n`);

  try {
    const result = await runVriskoDiscovery(datasetId);

    console.log(`\n✅ Discovery completed!`);
    console.log(`   Discovery Run ID: ${result.discoveryRunId}`);
    console.log(`   Cities processed: ${result.citiesProcessed}`);
    console.log(`   Industries processed: ${result.industriesProcessed}`);
    console.log(`   Searches executed: ${result.searchesExecuted}`);
    console.log(`   Businesses found: ${result.businessesFound}`);
    console.log(`   Businesses created: ${result.businessesCreated}`);
    console.log(`   Businesses updated: ${result.businessesUpdated}`);
    console.log(`   Contacts created: ${result.contactsCreated}`);
    console.log(`   Extraction jobs created: ${result.extractionJobsCreated}`);
    
    if (result.errors.length > 0) {
      console.log(`\n⚠️  Errors (${result.errors.length}):`);
      result.errors.slice(0, 10).forEach(err => console.log(`   - ${err}`));
      if (result.errors.length > 10) {
        console.log(`   ... and ${result.errors.length - 10} more`);
      }
    }
  } catch (error: any) {
    logger.error('Fatal error:', error);
    console.error(`\n❌ Discovery failed: ${error.message}`);
    process.exit(1);
  }
}

main();
