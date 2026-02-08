/**
 * CLI tool to run Vrisko discovery manually
 * 
 * Usage:
 *   npm run discover:vrisko [cityId] [industryId] [datasetId]
 * 
 * If no arguments provided, discovers all active city-industry combinations
 */

import dotenv from 'dotenv';
import { discoverBusinessesVrisko, discoverAllActiveCombinations } from '../discovery/vriskoDiscoveryWorker.js';
import { Logger } from '../crawler/vrisko/utils/logger.js';

dotenv.config();

const logger = new Logger('VriskoDiscoveryCLI');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Discover all active combinations
    console.log('🔍 Discovering businesses for all active city-industry combinations...\n');
    
    // Get userId from environment or prompt
    const userId = process.env.DEFAULT_USER_ID;
    if (!userId) {
      console.error('❌ ERROR: DEFAULT_USER_ID environment variable is required for bulk discovery');
      process.exit(1);
    }

    const result = await discoverAllActiveCombinations(userId);
    
    console.log(`\n✅ Bulk discovery completed!`);
    console.log(`   Total runs: ${result.totalRuns}`);
    console.log(`   Total businesses created: ${result.results.reduce((sum, r) => sum + r.businessesCreated, 0)}`);
    console.log(`   Total businesses updated: ${result.results.reduce((sum, r) => sum + r.businessesUpdated, 0)}`);
    console.log(`   Total errors: ${result.results.reduce((sum, r) => sum + r.errors.length, 0)}`);
    
  } else if (args.length >= 2) {
    // Discover specific city-industry combination
    const [cityId, industryId, datasetId] = args;
    
    if (!cityId || !industryId) {
      console.error('Usage: npm run discover:vrisko <cityId> <industryId> [datasetId]');
      process.exit(1);
    }

    console.log(`🔍 Discovering businesses for city ${cityId} and industry ${industryId}...\n`);

    // Get datasetId or create one
    let finalDatasetId = datasetId;
    if (!finalDatasetId) {
      const userId = process.env.DEFAULT_USER_ID;
      if (!userId) {
        console.error('❌ ERROR: Either provide datasetId or set DEFAULT_USER_ID environment variable');
        process.exit(1);
      }

      const { resolveDataset } = await import('../services/datasetResolver.js');
      const resolverResult = await resolveDataset({
        userId,
        cityId,
        industryId,
      });
      finalDatasetId = resolverResult.dataset.id;
      console.log(`📦 Created/resolved dataset: ${finalDatasetId}`);
    }

    const result = await discoverBusinessesVrisko(cityId, industryId, finalDatasetId);
    
    console.log(`\n✅ Discovery completed!`);
    console.log(`   Businesses found: ${result.businessesFound}`);
    console.log(`   Businesses created: ${result.businessesCreated}`);
    console.log(`   Businesses updated: ${result.businessesUpdated}`);
    console.log(`   Businesses skipped: ${result.businessesSkipped}`);
    console.log(`   Pages crawled: ${result.pagesCrawled}`);
    console.log(`   Searches executed: ${result.searchesExecuted}`);
    if (result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.length}`);
      result.errors.forEach(err => console.log(`     - ${err}`));
    }
  } else {
    console.error('Usage:');
    console.error('  npm run discover:vrisko                    # Discover all active combinations');
    console.error('  npm run discover:vrisko <cityId> <industryId> [datasetId]  # Discover specific combination');
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
