# Persistence Fallback Layer

Unified persistence interface that automatically falls back to local JSON files when the database is unavailable.

## Overview

The persistence layer provides a unified interface for data operations that works identically whether using a database or local JSON files. Workers don't need to know where data comes from.

## Architecture

### Interface

```typescript
interface PersistenceLayer {
  healthCheck(): Promise<boolean>;
  getUser(userId: string): Promise<User | null>;
  getDataset(datasetId: string): Promise<Dataset | null>;
  saveExport(data): Promise<ExportRecord>;
  getUserUsage(userId: string): Promise<UsageTracking>;
  incrementUsage(userId: string, type: 'export' | 'crawl' | 'dataset'): Promise<UsageTracking>;
}
```

### Implementations

1. **DbPersistence** - PostgreSQL database (primary)
2. **LocalPersistence** - Local JSON files (fallback)

### Resolver

The `resolvePersistence()` function:
1. Checks cached persistence health
2. Attempts database connection
3. Falls back to local JSON files if database unavailable
4. Caches the resolved persistence for performance
5. Logs fallback usage clearly

## Exposed Functions

### `getUser(userId)`

Get user by ID. Works with database or local JSON files.

```typescript
import { getUser } from '../persistence/index.js';

const user = await getUser(userId);
// Returns: { id, email, plan }
```

### `getDataset(datasetId)`

Get dataset by ID. Works with database or local JSON files.

```typescript
import { getDataset } from '../persistence/index.js';

const dataset = await getDataset(datasetId);
// Returns: { id, user_id, name, city_id, industry_id, ... }
```

### `saveExport(data)`

Save export record. Works with database or local JSON files.

```typescript
import { saveExport } from '../persistence/index.js';

const exportRecord = await saveExport({
  datasetId: '...',
  userId: '...',
  tier: 'starter',
  format: 'xlsx',
  rowCount: 100,
  filePath: '/path/to/file.xlsx',
  watermarkText: 'Demo Export',
});
```

### `incrementUsage(userId, type)`

Increment usage counter. Works with database or local JSON files.

```typescript
import { incrementUsage } from '../persistence/index.js';

// After successful export
await incrementUsage(userId, 'export');

// After successful crawl
await incrementUsage(userId, 'crawl');

// After creating dataset
await incrementUsage(userId, 'dataset');
```

### `getUserUsage(userId)`

Get current usage for a user. Works with database or local JSON files.

```typescript
import { getUserUsage } from '../persistence/index.js';

const usage = await getUserUsage(userId);
// Returns: { exports_this_month, crawls_this_month, datasets_created_this_month, month_year }
```

## Local Storage Structure

When database is unavailable, data is stored in `.local-persistence/`:

```
.local-persistence/
  ├── users.json          # User records
  ├── datasets.json       # Dataset records
  ├── exports.json        # Export records
  └── usage.json          # Usage tracking records
```

## Automatic Fallback

1. **Database Available**: Uses PostgreSQL
2. **Database Unavailable**: Automatically switches to local JSON files
3. **Transparent to Workers**: Workers use the same interface regardless

## Usage in Workers

### Before (Direct DB Access)

```typescript
import { getDatasetById } from '../db/datasets.js';
import { incrementExports } from '../db/usageTracking.js';

const dataset = await getDatasetById(datasetId);
await incrementExports(userId);
```

### After (Persistence Layer)

```typescript
import { getDataset, incrementUsage } from '../persistence/index.js';

const dataset = await getDataset(datasetId); // Works with DB or local
await incrementUsage(userId, 'export'); // Works with DB or local
```

## Benefits

- **Resilience**: System continues working when database is down
- **Transparency**: Workers don't need to know storage backend
- **Consistency**: Same interface for all operations
- **Automatic**: Fallback happens automatically
- **No Code Changes**: Workers use same code regardless of storage

## File Structure

```
src/persistence/
  ├── persistence.ts      # Interface definition
  ├── dbPersistence.ts    # Database implementation
  ├── localPersistence.ts # Local JSON implementation
  ├── resolver.ts         # Automatic fallback resolver
  ├── index.ts            # Exposed functions
  └── README.md           # This file
```

## Error Handling

- **Database Errors**: Automatically fall back to local JSON
- **Local Errors**: Logged but don't crash the system
- **Graceful Degradation**: Returns default values when possible

## Monthly Reset

Usage tracking automatically resets at the start of each month:
- New month-year record created automatically
- Counters reset to 0
- Works identically in database and local storage

## Integration

All workers now use the persistence layer:

- **Export Worker**: Uses `getDataset()`, `incrementUsage()`, `saveExport()`
- **Crawl Worker**: Uses `getUserUsage()`, `incrementUsage()`
- **Discovery Service**: Uses `getUserUsage()`, `incrementUsage()`

No worker code needs to change when switching between database and local storage.
