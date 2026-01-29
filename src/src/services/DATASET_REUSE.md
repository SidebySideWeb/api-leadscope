# Dataset Reuse Logic

Backend-only logic for reusing datasets when they exist for the same city and industry and were refreshed within 30 days.

## Rules

1. **Reuse Condition**: If a dataset exists for:
   - Same `city_id`
   - Same `industry_id`
   - `last_refreshed_at` < 30 days ago
   - Then reuse that dataset

2. **Create New**: Otherwise, create a new dataset

3. **Backend Only**: This logic is **only exposed in the backend**. The UI should not care about reuse - it just sends city and industry, and the backend handles dataset resolution.

## Database Schema

The `datasets` table has been extended with:
- `city_id` (INTEGER, references cities)
- `industry_id` (INTEGER, references industries)
- `last_refreshed_at` (TIMESTAMPTZ)

## Usage

### Automatic Resolution (Recommended)

```typescript
import { resolveDataset } from './services/datasetResolver.js';

// Resolve dataset automatically (reuse if available, create if not)
const result = await resolveDataset({
  userId: 'user-123',
  cityName: 'Athens',
  industryName: 'Restaurants',
});

console.log(result.dataset.id); // Dataset ID (reused or new)
console.log(result.isReused); // true if reused, false if new
console.log(result.shouldRefresh); // true if dataset is stale
```

### Manual Dataset Creation

```typescript
import { getOrCreateDataset } from './db/datasets.js';

// Create or reuse dataset directly
const dataset = await getOrCreateDataset(
  userId,
  cityId,
  industryId,
  'My Dataset Name' // optional
);
```

### Mark Dataset as Refreshed

```typescript
import { markDatasetRefreshed } from './services/datasetResolver.js';

// After successful discovery/refresh, mark dataset as refreshed
await markDatasetRefreshed(datasetId);
```

## Integration with Discovery Service

The discovery service automatically uses dataset reuse logic:

```typescript
import { runDiscoveryJob } from './services/discoveryService.js';

// Option 1: Let backend resolve dataset (recommended)
await runDiscoveryJob({
  userId: 'user-123',
  industry: 'Restaurants',
  city: 'Athens',
  // datasetId not provided - will be resolved automatically
});

// Option 2: Explicitly provide dataset ID
await runDiscoveryJob({
  datasetId: 'explicit-dataset-id',
  industry: 'Restaurants',
  city: 'Athens',
  // Will use provided dataset directly
});
```

## Behavior

### When Dataset is Reused

- Returns existing dataset ID
- `isReused = true`
- `last_refreshed_at` is updated after successful discovery
- No new dataset is created

### When New Dataset is Created

- Creates new dataset with `city_id` and `industry_id`
- Sets `last_refreshed_at = NOW()`
- `isReused = false`
- Returns new dataset ID

### When Dataset is Stale (> 30 days)

- Creates new dataset (old one is not reused)
- Old dataset remains in database but is not used
- `isReused = false`

## Migration

Run the migration to add the required fields:

```bash
npm run migrate -- add_dataset_reuse_fields.sql
```

## Notes

- **UI Transparency**: The UI should not know about reuse logic. It just sends city and industry, and receives a dataset ID back.
- **30-Day Window**: Datasets are reused if refreshed within the last 30 days. After 30 days, a new dataset is created.
- **User Isolation**: Datasets are always scoped to a user (`user_id`). Users cannot see or reuse each other's datasets.
- **Automatic Refresh**: After successful discovery, `last_refreshed_at` is automatically updated to `NOW()`.
