# Discovery Persistence Implementation

## Overview

The discovery system now fully persists Google Places results to the `businesses` table with automatic duplicate handling using PostgreSQL's `ON CONFLICT DO NOTHING` clause.

## Database Changes

### Unique Constraint

Added unique constraint on `google_place_id` to prevent duplicates:

```sql
ALTER TABLE businesses
ADD CONSTRAINT unique_google_place_id
UNIQUE (google_place_id);
```

**Migration:** `src/db/migrations/add_google_place_unique.sql`

**Run migration:**
```bash
npm run migrate:google-place-unique
```

## Implementation Details

### 1. Automatic Duplicate Handling

The `createBusiness()` function now uses `ON CONFLICT DO NOTHING`:

```typescript
INSERT INTO businesses (...)
VALUES (...)
ON CONFLICT (google_place_id) DO NOTHING
RETURNING *;
```

**Benefits:**
- No need to check for existence before insert
- Atomic operation (no race conditions)
- Automatically skips duplicates
- Returns `null` if conflict occurs (business already exists)

### 2. Persistence Flow

```
1. Discovery fetches Google Places results
   ↓
2. For each place:
   - Extract city from address_components
   - Resolve city_id (get or create)
   - Insert business with ON CONFLICT DO NOTHING
   ↓
3. If inserted (new):
   - Increment businessesCreated
   - Create website if exists
   - Create crawl job
   ↓
4. If conflict (duplicate):
   - Check if exists in this dataset
   - Update if belongs to dataset
   - Skip if belongs to different dataset
   - Track as businessesSkipped or businessesUpdated
```

### 3. City Resolution

City is extracted from Google Places `address_components`:

1. **Primary:** Look for `type: 'locality'`
2. **Fallback:** Look for `type: 'administrative_area_level_2'`
3. **Last resort:** Extract from `formatted_address`

Then:
- Normalize city name
- Lookup in `cities` table
- Create if not found
- Reuse existing `city_id`

### 4. Logging

Comprehensive logging at each stage:

```
💾 Persisting N businesses to database...
   Dataset ID: X
   Owner User ID: Y

📊 Persistence Summary:
   Total places fetched: N
   Businesses inserted: X
   Businesses skipped (duplicates): Y
   Businesses updated: Z
   Websites created: W
```

## Usage

### CLI

```bash
# Run discovery (requires dataset ID)
npm run discover "Λογιστικά γραφεία" "Αθήνα" 1

# With geo-grid
npm run discover "restaurant" "Athens" 1 --geo-grid
```

### Verify Persistence

After running discovery, verify businesses were inserted:

```sql
SELECT count(*) FROM businesses;
SELECT count(*) FROM businesses WHERE dataset_id = 1;
```

## Result Tracking

The `DiscoveryResult` interface now includes:

```typescript
interface DiscoveryResult {
  businessesFound: number;      // Total places fetched
  businessesCreated: number;    // New businesses inserted
  businessesSkipped: number;    // Duplicates skipped
  businessesUpdated: number;    // Existing businesses updated
  websitesCreated: number;      // Websites created
  errors: string[];             // Any errors encountered
}
```

## Key Features

### ✅ Automatic Deduplication
- Uses PostgreSQL unique constraint
- `ON CONFLICT DO NOTHING` handles duplicates atomically
- No race conditions

### ✅ Dataset Ownership
- All businesses tagged with `dataset_id` and `owner_user_id`
- Prevents cross-user contamination
- Updates only businesses in same dataset

### ✅ City Resolution
- Extracts city from Google address components
- Normalizes and deduplicates cities
- Creates cities if not found

### ✅ Comprehensive Logging
- Logs total fetched, inserted, skipped, updated
- Shows dataset and user IDs
- Tracks errors

### ✅ Error Handling
- Continues processing on individual place errors
- Collects all errors in result
- Logs errors without stopping discovery

## Database Schema

### Businesses Table

```sql
CREATE TABLE businesses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  address TEXT,
  postal_code TEXT,
  city_id INTEGER REFERENCES cities(id),
  industry_id INTEGER REFERENCES industries(id),
  google_place_id TEXT UNIQUE,  -- Unique constraint added
  dataset_id INTEGER REFERENCES datasets(id),
  owner_user_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Migration Steps

1. **Run unique constraint migration:**
   ```bash
   npm run migrate:google-place-unique
   ```

2. **Verify constraint exists:**
   ```sql
   SELECT constraint_name, constraint_type
   FROM information_schema.table_constraints
   WHERE table_name = 'businesses'
     AND constraint_name = 'unique_google_place_id';
   ```

3. **Test discovery:**
   ```bash
   npm run discover "restaurant" "Athens" 1
   ```

4. **Verify persistence:**
   ```sql
   SELECT count(*) FROM businesses;
   ```

## Troubleshooting

### No businesses inserted

**Check:**
1. Are there errors in the discovery result?
2. Are all businesses being skipped as duplicates?
3. Is the dataset ID correct?
4. Are Google Places results being fetched?

**Debug:**
```typescript
// Check discovery result
console.log(result);

// Check database
SELECT * FROM businesses WHERE dataset_id = 1 LIMIT 10;
```

### Duplicate constraint errors

**Cause:** Migration not run or constraint not applied.

**Fix:**
```bash
npm run migrate:google-place-unique
```

### City resolution failures

**Check:**
- Google Places API returning `address_components`?
- City name extraction logic working?
- Cities table accessible?

**Debug:**
```typescript
console.log('Place:', place);
console.log('Address components:', place.address_components);
```

## Performance

- **Batch processing:** Processes places sequentially (can be parallelized)
- **Database:** Uses parameterized queries (safe, fast)
- **Deduplication:** Handled by database (efficient)
- **Indexes:** Unique constraint creates index automatically

## Security

- ✅ Parameterized SQL (prevents SQL injection)
- ✅ Dataset ownership validation
- ✅ User ownership validation
- ✅ No raw data storage (only normalized fields)

## Next Steps

After persistence is working:

1. **Exports:** Businesses are now available for export
2. **Refresh:** Businesses can be refreshed monthly
3. **Crawling:** Websites are queued for crawling
4. **Contacts:** Contacts will be extracted during crawl
