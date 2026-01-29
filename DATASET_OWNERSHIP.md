# Dataset Ownership System

## Overview

Every business must belong to a dataset and have an owner user. This prevents cross-user data contamination and ensures proper data isolation.

## Business Rules

### Ownership Enforcement

- **Every business** must have:
  - `dataset_id` - Links business to a dataset
  - `owner_user_id` - Must match `dataset.user_id`

- **Enforced at application level** (not SQL constraints)
- **Prevents cross-user contamination**
- **Required for all discovery operations**

## Database Schema

### Businesses Table

```sql
ALTER TABLE businesses
ADD COLUMN dataset_id INTEGER REFERENCES datasets(id),
ADD COLUMN owner_user_id VARCHAR(255) NOT NULL;
```

### Datasets Table (assumed structure)

```sql
CREATE TABLE datasets (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Discovery Logic

### Required Fields

When creating a business during discovery:

```typescript
await createBusiness({
  name: place.name,
  address: place.formatted_address,
  postal_code: postalCode,
  city_id: city.id,
  industry_id: industryId,
  google_place_id: place.place_id,
  dataset_id: dataset.id,        // Required
  owner_user_id: dataset.user_id // Required
});
```

### Deduplication

Businesses are deduplicated **within a dataset**:

```typescript
// Check for existing business within this dataset
const business = await getBusinessByGooglePlaceId(
  place.place_id,
  datasetId  // Scoped to dataset
);
```

This ensures:
- Same Google Place can exist in multiple datasets
- No cross-dataset contamination
- Proper ownership tracking

## Usage

### CLI

```bash
# Discovery requires dataset ID
npm run discover "restaurant" "Athens" 1
#                                    ^ dataset ID
```

### Programmatic

```typescript
import { discoverBusinesses } from './workers/discoveryWorker.js';

await discoverBusinesses({
  industry: 'restaurant',
  city: 'Athens',
  datasetId: 1  // Required
});
```

## Export Filtering

Exports automatically filter by dataset and user:

```typescript
// Export only includes businesses from user's dataset
const rows = await queryExportData({
  datasetId: dataset.id,
  ownerUserId: dataset.user_id
});
```

## Security

### Validation

1. **Dataset exists** - Verified before discovery
2. **User ownership** - `business.owner_user_id === dataset.user_id`
3. **Dataset scoping** - All queries filtered by `dataset_id`

### Prevention

- ✅ No cross-user data access
- ✅ No dataset contamination
- ✅ Proper ownership tracking
- ✅ Scoped deduplication

## Migration

Run migration to add ownership columns:

```bash
npm run migrate add_business_ownership.sql
```

**Note:** Existing businesses will need to be migrated manually or set to a default dataset.

## Best Practices

1. **Always provide datasetId** - Required for all discovery operations
2. **Verify ownership** - Check dataset belongs to user before discovery
3. **Scope queries** - Always filter by dataset_id in queries
4. **Validate at creation** - Ensure owner_user_id matches dataset.user_id

## Example Flow

```
1. User requests discovery for dataset 1
   ↓
2. System verifies dataset exists
   ↓
3. System gets dataset.user_id
   ↓
4. Discovery creates businesses with:
   - dataset_id = 1
   - owner_user_id = dataset.user_id
   ↓
5. All queries filter by dataset_id
   ↓
6. Exports only include user's dataset
```

## Error Handling

If dataset ownership is violated:

- Discovery fails with clear error
- Business creation rejected
- Export returns empty results
- No silent data leakage
