/**
 * Example usage of the store abstraction
 * This file demonstrates how to use the store with automatic fallback
 */

import { resolveStore } from './resolver.js';
import { datasetResolver } from './resolver.js';
import { getUserPlan, enforceExportLimit } from '../limits/exportLimits.js';

export async function exampleUsage() {
  const userId = 'user-123';
  const datasetId = 'dataset-456';

  // 1. Resolve store (automatic fallback)
  console.log('Resolving store...');
  const store = await resolveStore();
  console.log(`Using store: ${store.constructor.name}`);

  // 2. Check health
  const healthy = await store.healthCheck();
  console.log(`Store health: ${healthy ? 'OK' : 'FAILED'}`);

  // 3. Get latest dataset
  const dataset = await store.getLatestDataset(userId);
  console.log(`Latest dataset: ${dataset?.id || 'none'}`);

  // 4. Resolve dataset with snapshot reuse
  console.log('Resolving dataset with snapshot...');
  const { dataset: resolvedDataset, snapshot, shouldQueueDiscovery } = await datasetResolver(
    userId,
    datasetId
  );

  if (snapshot) {
    console.log(`Using snapshot (${snapshot.data.businesses.length} businesses)`);
  } else if (resolvedDataset) {
    console.log(`Using dataset: ${resolvedDataset.id}`);
  }

  if (shouldQueueDiscovery) {
    console.log('Discovery queued in background');
  }

  // 5. Create crawl job
  const crawlJob = await store.createCrawlJob({
    business_id: 'business-789',
    website_url: 'https://example.com',
    pages_limit: 15
  });
  console.log(`Created crawl job: ${crawlJob.id}`);

  // 6. Save crawled page
  const page = await store.savePage(crawlJob.id, {
    url: 'https://example.com',
    final_url: 'https://example.com/',
    status_code: 200,
    content_type: 'text/html',
    html: '<html>...</html>',
    hash: 'abc123...'
  });
  console.log(`Saved page: ${page.id}`);

  // 7. Save contacts
  const contacts = await store.saveContacts(123, [
    {
      email: 'contact@example.com',
      source_url: 'https://example.com/contact',
      confidence: 0.9
    }
  ]);
  console.log(`Saved ${contacts.length} contacts`);

  // 8. Get export rows with plan limits
  const plan = await getUserPlan(userId);
  const limitCheck = enforceExportLimit(plan);
  console.log(`Plan: ${plan}, Max rows: ${limitCheck.maxRows}`);

  const rows = await store.getExportRows({
    datasetId,
    userId,
    rowLimit: limitCheck.maxRows
  });
  console.log(`Got ${rows.length} export rows`);

  // 9. Create snapshot
  if (resolvedDataset) {
    const snapshot = await store.createDatasetSnapshot(resolvedDataset.id, userId, {
      businesses: [
        {
          id: 1,
          name: 'Example Business',
          industry: 'Technology',
          city: 'Athens',
          website: 'https://example.com'
        }
      ],
      contacts: [
        {
          business_id: 1,
          email: 'contact@example.com',
          phone: null,
          mobile: null,
          source_url: 'https://example.com/contact'
        }
      ]
    });
    console.log(`Created snapshot: ${snapshot.id}`);
  }
}

// Run example (commented out to avoid execution)
// exampleUsage().catch(console.error);
