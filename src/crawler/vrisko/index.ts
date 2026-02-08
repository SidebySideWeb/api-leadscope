/**
 * Main entry point for vrisko.gr crawler
 * Can be used as CLI tool or imported as module
 */

import { VriskoCrawler } from './vriskoCrawler.js';
import { Logger } from './utils/logger.js';

const logger = new Logger('VriskoCrawlerCLI');

/**
 * CLI usage: node index.js "keyword" "location" [maxPages]
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node index.js "keyword" "location" [maxPages]');
    console.log('Example: node index.js "Γιατρός" "Αθήνα ΑΤΤΙΚΗΣ" 10');
    process.exit(1);
  }

  const [keyword, location, maxPagesStr] = args;
  const maxPages = maxPagesStr ? parseInt(maxPagesStr, 10) : undefined;

  if (isNaN(maxPages as number) && maxPagesStr) {
    logger.error(`Invalid maxPages: ${maxPagesStr}`);
    process.exit(1);
  }

  logger.info(`Starting crawl: "${keyword}" in "${location}"`);
  if (maxPages) {
    logger.info(`Max pages: ${maxPages}`);
  }

  const crawler = new VriskoCrawler({
    maxPages,
    concurrency: 1, // Sequential for CLI
    delayBetweenPages: true,
  });

  try {
    const results = await crawler.crawl(keyword, location, maxPages);
    
    // Output results as JSON
    console.log('\n=== CRAWL RESULTS ===');
    console.log(JSON.stringify(results, null, 2));
    console.log(`\nTotal: ${results.length} businesses found`);
  } catch (error: any) {
    logger.error('Crawl failed:', error);
    process.exit(1);
  }
}

// Run CLI if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

export { VriskoCrawler } from './vriskoCrawler.js';
export { VriskoParser, type VriskoBusiness } from './vriskoParser.js';
export { HttpClient } from './utils/httpClient.js';
export { Logger } from './utils/logger.js';
export { randomDelay, standardDelay } from './utils/delay.js';
