/**
 * CLI tool to test vrisko.gr crawler
 * Usage: npm run test:vrisko "keyword" "location" [maxPages]
 */

import { VriskoCrawler } from '../crawler/vrisko/vriskoCrawler.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: npm run test:vrisko "keyword" "location" [maxPages]');
    console.log('Example: npm run test:vrisko "Γιατρός" "Αθήνα ΑΤΤΙΚΗΣ" 5');
    process.exit(1);
  }

  const [keyword, location, maxPagesStr] = args;
  const maxPages = maxPagesStr ? parseInt(maxPagesStr, 10) : 5;

  if (isNaN(maxPages)) {
    console.error(`Invalid maxPages: ${maxPagesStr}`);
    process.exit(1);
  }

  console.log(`\n🧪 Testing vrisko.gr crawler`);
  console.log(`   Keyword: "${keyword}"`);
  console.log(`   Location: "${location}"`);
  console.log(`   Max pages: ${maxPages}\n`);

  const crawler = new VriskoCrawler({
    maxPages,
    concurrency: 1,
    delayBetweenPages: true,
  });

  try {
    const results = await crawler.crawl(keyword, location, maxPages);
    
    console.log(`\n✅ Crawl completed!`);
    console.log(`   Total businesses found: ${results.length}\n`);
    
    if (results.length > 0) {
      console.log('Sample results:');
      results.slice(0, 3).forEach((business, idx) => {
        console.log(`\n${idx + 1}. ${business.name}`);
        console.log(`   Category: ${business.category}`);
        console.log(`   Address: ${business.address.street}, ${business.address.city}`);
        console.log(`   Phones: ${business.phones.join(', ') || 'None'}`);
        console.log(`   Email: ${business.email || 'None'}`);
        console.log(`   Website: ${business.website || 'None'}`);
        console.log(`   URL: ${business.listing_url}`);
      });
    }
  } catch (error: any) {
    console.error('\n❌ Crawl failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
