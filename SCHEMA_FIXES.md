# Schema Fixes Summary

## Overview

Fixed schema mismatches between Supabase PostgreSQL database and TypeScript codebase. All changes ensure data integrity, proper normalization, and correct duplicate handling.

## A) Businesses Table Fixes

### Issues Fixed

1. **`created_at` and `updated_at` columns**
   - ✅ Ensured both columns exist with proper defaults
   - ✅ Added automatic `updated_at` trigger

2. **`normalized_name` validation**
   - ✅ Never empty - throws error if normalization results in empty string
   - ✅ NOT NULL constraint in database
   - ✅ Validation in application code before insert

3. **Duplicate handling**
   - ✅ Unique constraint on `(dataset_id, normalized_name)`
   - ✅ `ON CONFLICT` performs UPDATE instead of INSERT
   - ✅ Automatically increments `updated_at` on conflict

4. **Business name normalization**
   - ✅ Lowercase conversion
   - ✅ Remove Greek accents (ά→α, έ→ε, etc.)
   - ✅ Replace symbols with dash
   - ✅ Trim dashes from start/end
   - ✅ Remove multiple consecutive dashes

5. **Safety logging**
   - ✅ Logs normalized name before insert
   - ✅ Logs dataset_id
   - ✅ Logs whether INSERT or UPDATE path was taken

### Code Changes

**File: `src/utils/deduplication.ts`**
- Enhanced `normalizeBusinessName()` function
- Throws error if normalization results in empty string
- Handles Greek accents, symbols, dashes properly

**File: `src/db/businesses.ts`**
- `createBusiness()` now uses `ON CONFLICT (dataset_id, normalized_name) DO UPDATE`
- Validates normalized_name before insert
- Adds comprehensive logging
- Always sets `created_at` and `updated_at`

**File: `src/db/migrations/fix_businesses_schema.sql`**
- Adds `created_at` and `updated_at` if missing
- Makes `normalized_name` NOT NULL
- Adds unique constraint on `(dataset_id, normalized_name)`
- Creates automatic `updated_at` trigger

## B) Crawl Jobs Table Fixes

### Issues Fixed

1. **New fields added:**
   - ✅ `pages_crawled` (integer, default 0)
   - ✅ `pages_limit` (integer, default 25)
   - ✅ `status` updated to use 'running' instead of 'in_progress'
   - ✅ `started_at` (timestamptz)
   - ✅ `completed_at` (timestamptz)

2. **Status values:**
   - Changed from: `'pending' | 'in_progress' | 'completed' | 'failed'`
   - Changed to: `'pending' | 'running' | 'completed' | 'failed'`

### Code Changes

**File: `src/types/index.ts`**
- Updated `CrawlJob` interface to include `pages_limit`
- Changed status type from `'in_progress'` to `'running'`

**File: `src/db/crawlJobs.ts`**
- `createCrawlJob()` now accepts `pages_limit` parameter (default 25)
- `updateCrawlJob()` supports all new fields
- Added `getRunningCrawlJobs()` helper function

**File: `src/workers/crawlerWorker.ts`**
- Updated status from `'in_progress'` to `'running'`

**File: `src/db/migrations/fix_crawl_jobs_schema.sql`**
- Adds `pages_limit` column (default 25)
- Ensures `pages_crawled` exists (default 0)
- Updates existing 'in_progress' records to 'running'
- Updates check constraint
- Adds `started_at` and `completed_at` if missing
- Creates indexes for performance

## C) Duplicate Handling

### Implementation

When unique constraint fails on `(dataset_id, normalized_name)`:

1. **Database level:**
   ```sql
   ON CONFLICT (dataset_id, normalized_name) 
   DO UPDATE SET
     name = EXCLUDED.name,
     address = EXCLUDED.address,
     postal_code = EXCLUDED.postal_code,
     city_id = EXCLUDED.city_id,
     industry_id = EXCLUDED.industry_id,
     google_place_id = COALESCE(EXCLUDED.google_place_id, businesses.google_place_id),
     updated_at = NOW()
   ```

2. **Application level:**
   - Logs normalized name and dataset_id
   - Determines if INSERT or UPDATE path was taken
   - Returns updated business record

## D) Business Name Normalization

### Algorithm

```typescript
1. Convert to lowercase
2. Remove Greek accents:
   - ά→α, έ→ε, ή→η, ί→ι, ό→ο, ύ→υ, ώ→ω
   - Ά→α, Έ→ε, Ή→η, Ί→ι, Ό→ο, Ύ→υ, Ώ→ω
3. Replace symbols with dash: [^\w\s-] → '-'
4. Normalize whitespace: multiple spaces → single space
5. Replace spaces with dashes
6. Remove multiple consecutive dashes: '---' → '-'
7. Trim dashes from start and end
8. Validate: throw error if empty
```

### Examples

- `"Café & Restaurant"` → `"cafe-restaurant"`
- `"Στοά & Co."` → `"στοα-co"`
- `"Business   Name!!!"` → `"business-name"`
- `"---Test---"` → `"test"`

## E) Safety Logging

### Logs Added

**In `createBusiness()`:**
```typescript
console.log(`[createBusiness] Processing business:`, {
  name: data.name,
  normalized_name,
  dataset_id: data.dataset_id,
  google_place_id: data.google_place_id || 'null'
});

console.log(`[createBusiness] ${wasUpdate ? 'UPDATE' : 'INSERT'} path:`, {
  business_id: business.id,
  normalized_name: business.normalized_name,
  dataset_id: business.dataset_id
});
```

**In `updateBusiness()`:**
```typescript
console.log(`[updateBusiness] Updating name:`, {
  business_id: id,
  name: data.name,
  normalized_name
});
```

## SQL Migrations

### Run Migrations

```bash
# Fix businesses table
npm run migrate fix_businesses_schema.sql

# Fix crawl_jobs table
npm run migrate fix_crawl_jobs_schema.sql
```

### Migration Files

1. **`src/db/migrations/fix_businesses_schema.sql`**
   - Adds `created_at` and `updated_at`
   - Makes `normalized_name` NOT NULL
   - Adds unique constraint on `(dataset_id, normalized_name)`
   - Creates automatic `updated_at` trigger

2. **`src/db/migrations/fix_crawl_jobs_schema.sql`**
   - Adds `pages_limit` (default 25)
   - Ensures `pages_crawled` (default 0)
   - Updates status from 'in_progress' to 'running'
   - Adds `started_at` and `completed_at`
   - Creates indexes

## Testing

### Verify Businesses Table

```sql
-- Check columns exist
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'businesses'
  AND column_name IN ('created_at', 'updated_at', 'normalized_name');

-- Check unique constraint
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'businesses'
  AND constraint_name = 'unique_business_dataset_name';

-- Test normalization
SELECT name, normalized_name FROM businesses LIMIT 10;
```

### Verify Crawl Jobs Table

```sql
-- Check columns exist
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'crawl_jobs'
  AND column_name IN ('pages_limit', 'pages_crawled', 'started_at', 'completed_at');

-- Check status constraint
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'crawl_jobs'
  AND constraint_name = 'crawl_jobs_status_check';
```

## Breaking Changes

1. **Status value change:**
   - Old: `'in_progress'`
   - New: `'running'`
   - Migration automatically updates existing records

2. **Normalized name validation:**
   - Now throws error if normalization results in empty string
   - Previously returned empty string silently

3. **Duplicate handling:**
   - Now performs UPDATE on conflict instead of DO NOTHING
   - Previously skipped duplicate inserts

## Files Modified

1. `src/utils/deduplication.ts` - Enhanced normalization
2. `src/db/businesses.ts` - Validation, duplicate handling, logging
3. `src/db/crawlJobs.ts` - New fields support
4. `src/types/index.ts` - Updated CrawlJob interface
5. `src/workers/crawlerWorker.ts` - Status value update
6. `src/db/migrations/fix_businesses_schema.sql` - New migration
7. `src/db/migrations/fix_crawl_jobs_schema.sql` - New migration

## Next Steps

1. **Run migrations:**
   ```bash
   npm run migrate fix_businesses_schema.sql
   npm run migrate fix_crawl_jobs_schema.sql
   ```

2. **Test normalization:**
   ```typescript
   import { normalizeBusinessName } from './utils/deduplication.js';
   console.log(normalizeBusinessName("Café & Restaurant")); // "cafe-restaurant"
   ```

3. **Test duplicate handling:**
   - Insert same business twice with same dataset_id
   - Verify UPDATE path is taken
   - Check logs for INSERT vs UPDATE

4. **Monitor logs:**
   - Check console output for normalization logs
   - Verify dataset_id and normalized_name are logged
   - Confirm INSERT/UPDATE path detection
