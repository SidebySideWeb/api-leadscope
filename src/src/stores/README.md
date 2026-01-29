# Store Abstraction with Automatic Fallback

This module provides a unified store interface with automatic fallback from Supabase (database) to LocalStore (filesystem JSON) when the database is unavailable.

## Architecture

### Store Interface

All stores implement the `Store` interface with the following methods:

- `healthCheck()`: Returns `true` if the store is available
- `getLatestDataset(userId)`: Get the most recent dataset for a user
- `createDatasetSnapshot(datasetId, userId, data)`: Create a cached snapshot
- `getDatasetSnapshot(datasetId, userId)`: Get snapshot if valid (<30 days old)
- `createCrawlJob(input)`: Create a new crawl job
- `savePage(crawlJobId, page)`: Save a crawled page
- `saveContacts(businessId, contacts)`: Save extracted contacts
- `getExportRows(filters)`: Get rows for export with filters

### Implementations

1. **SupabaseStore**: Real PostgreSQL database via Supabase
   - Uses existing database connection pool
   - Full SQL queries and transactions
   - Production-ready

2. **LocalStore**: Filesystem-based JSON fallback
   - Stores data in `.local-store/` directory
   - JSON files for datasets, snapshots, crawl jobs, pages, contacts
   - Used when database is unavailable

### Resolver

The `resolveStore()` function:
1. Checks cached store health
2. Attempts SupabaseStore health check
3. Falls back to LocalStore if Supabase unavailable
4. Caches the resolved store for performance
5. Logs fallback usage clearly

### Dataset Resolver

The `datasetResolver()` function:
1. Checks for valid snapshot (<30 days old)
2. Reuses snapshot if available
3. Queues discovery job (non-blocking) if snapshot expired
4. Returns dataset, snapshot, and queue status

## Usage

```typescript
import { resolveStore } from './stores/resolver.js';
import { datasetResolver } from './stores/resolver.js';

// Get store (automatically falls back if needed)
const store = await resolveStore();

// Check if using fallback
const isFallback = store.constructor.name === 'LocalStore';

// Resolve dataset with snapshot reuse
const { dataset, snapshot, shouldQueueDiscovery } = await datasetResolver(userId, datasetId);

// Use store methods
const rows = await store.getExportRows({
  datasetId: '...',
  userId: '...',
  rowLimit: 100
});
```

## Export Service Integration

The export service (`exportServiceV2.ts`) uses the store abstraction and enforces plan-based limits:

- **Demo users**: Max 50 rows per export
- **Paid users**: Unlimited rows
- **Admin users**: Unlimited rows

Limits are enforced server-side before generating export files.

## Logging

The system logs clearly when fallback is used:

```
[store] Using SupabaseStore (database)
[store] ⚠️  Supabase unavailable, falling back to LocalStore (filesystem)
[datasetResolver] Using snapshot (15.3 days old)
[datasetResolver] Snapshot expired (32.1 days old), queueing discovery
```

## Database Migration

Run the migration to create the `dataset_snapshots` table:

```bash
npm run migrate create_dataset_snapshots.sql
```

## Local Store Directory Structure

```
.local-store/
  ├── datasets.json          # User datasets
  ├── crawl-jobs.json        # Crawl job queue
  ├── contacts.json          # Extracted contacts
  ├── snapshots/             # Dataset snapshots
  │   └── {snapshot-id}.json
  └── pages/                 # Crawled pages
      └── {page-id}.json
```

## Notes

- Snapshots expire after 30 days
- Discovery jobs are queued in-memory (non-blocking)
- LocalStore is not suitable for production (use for development/fallback only)
- All store operations are async and return Promises
