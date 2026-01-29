# Database Schema Stabilization Summary

## Overview

Stabilized database schema and discovery logic to ensure idempotent discovery runs with zero errors on duplicates.

## Changes Made

### 1. Database Migrations

#### A) Businesses Table (`stabilize_businesses_schema.sql`)

**Changes:**
- ✅ Added `updated_at TIMESTAMPTZ DEFAULT NOW()` if missing
- ✅ Ensured `normalized_name` is NOT NULL
- ✅ Added SQL fallback function: `compute_normalized_name()` using `lower(trim(regexp_replace(name, '\s+', ' ', 'g')))`
- ✅ Added check constraint to ensure `normalized_name` is never empty

**Migration File:** `src/db/migrations/stabilize_businesses_schema.sql`

#### B) Crawl Jobs Table

**Status:** ✅ Already complete
- `pages_crawled INTEGER DEFAULT 0` already exists in `fix_crawl_jobs_schema.sql`

### 2. Discovery Normalization

**File:** `src/utils/deduplication.ts`

**Function:** `normalizeBusinessName(name: string)`

**Behavior:**
- ✅ Computed **BEFORE** insert/update
- ✅ Never allows empty string (throws error)
- ✅ Deterministic normalization:
  - Lowercase conversion
  - Remove Greek accents
  - Replace symbols with dash
  - Normalize whitespace
  - Trim dashes

**Usage:**
```typescript
// In createBusiness() and updateBusiness()
const normalized_name = normalizeBusinessName(data.name); // Computed before SQL
```

### 3. Duplicate Handling

**File:** `src/db/businesses.ts`

**Function:** `createBusiness()`

**Previous Behavior:**
- Used `ON CONFLICT (dataset_id, normalized_name) DO UPDATE`
- Updated existing records on conflict

**New Behavior:**
- ✅ Uses `ON CONFLICT (dataset_id, normalized_name) DO NOTHING`
- ✅ Returns existing business id if conflict occurs
- ✅ Silent on duplicates (no errors thrown)
- ✅ Idempotent: multiple runs produce same result

**Implementation:**
```typescript
// Insert with DO NOTHING
const result = await pool.query(`
  INSERT INTO businesses (...)
  VALUES (...)
  ON CONFLICT (dataset_id, normalized_name) 
  DO NOTHING
  RETURNING *
`);

// If conflict occurred, fetch and return existing business
if (result.rows.length === 0) {
  const existingBusiness = await getBusinessByNormalizedName(normalized_name, dataset_id);
  return existingBusiness;
}
```

### 4. Update Logic

**File:** `src/db/businesses.ts`

**Function:** `updateBusiness()`

**Changes:**
- ✅ Only references columns that actually exist in schema
- ✅ Uses `updated_at = NOW()` (trigger also sets it)
- ✅ Computes `normalized_name` before update
- ✅ Throws error if business not found (prevents silent failures)

**Columns Referenced:**
- `name` (with `normalized_name`)
- `address`
- `postal_code`
- `city_id`
- `industry_id`
- `updated_at`

### 5. Discovery Worker Updates

**File:** `src/workers/discoveryWorker.ts`

**Changes:**
- ✅ Pre-checks for existing business by `google_place_id` (prevents unnecessary inserts)
- ✅ Uses `createBusiness()` which handles duplicates silently
- ✅ Determines if business is new by checking `created_at` timestamp
- ✅ Removed unused `updateBusiness` import

**Flow:**
1. Check if business exists by `google_place_id` → skip if exists
2. Call `createBusiness()` → handles `(dataset_id, normalized_name)` conflicts
3. If new business → create website and crawl job
4. If duplicate → skip silently

## Idempotency Guarantees

### Multiple Discovery Runs

Running `npm run discover` multiple times for the same dataset:

1. **First Run:**
   - Inserts new businesses
   - Creates websites
   - Creates crawl jobs
   - Returns: `businessesCreated > 0`

2. **Subsequent Runs:**
   - Skips businesses by `google_place_id` (pre-check)
   - Skips businesses by `(dataset_id, normalized_name)` (ON CONFLICT DO NOTHING)
   - Returns: `businessesSkipped > 0`, `businessesCreated = 0`
   - **Zero errors** ✅

### Duplicate Scenarios

1. **Same `google_place_id`:**
   - Pre-check catches it → skip immediately

2. **Same `(dataset_id, normalized_name)`:**
   - `ON CONFLICT DO NOTHING` → returns existing business id
   - No error thrown

3. **Different `google_place_id` but same normalized name:**
   - Handled by unique constraint on `(dataset_id, normalized_name)`
   - Returns existing business id

## Safety Features

- ✅ TypeScript strict mode maintained
- ✅ Existing function signatures preserved
- ✅ No table name changes
- ✅ No new concepts introduced
- ✅ SQL fallback for `normalized_name` at database level
- ✅ Check constraint prevents empty `normalized_name`
- ✅ Automatic `updated_at` trigger

## Migration Instructions

Run the stabilization migration:

```bash
npm run migrate stabilize_businesses_schema.sql
```

**Note:** This migration is safe to run multiple times (uses `IF NOT EXISTS` and `IF EXISTS`).

## Testing

After migration, test idempotency:

```bash
# First run
npm run discover "Λογιστικά γραφεία" "Αθήνα" <dataset-uuid>

# Second run (should produce zero errors)
npm run discover "Λογιστικά γραφεία" "Αθήνα" <dataset-uuid>
```

Expected result:
- First run: `businessesCreated > 0`
- Second run: `businessesSkipped > 0`, `businessesCreated = 0`, **zero errors**

## Files Modified

1. `src/db/migrations/stabilize_businesses_schema.sql` (new)
2. `src/db/businesses.ts` (updated `createBusiness()` and `updateBusiness()`)
3. `src/workers/discoveryWorker.ts` (updated duplicate handling logic)
4. `src/utils/deduplication.ts` (already correct, no changes needed)

## Summary

✅ **Database schema stabilized**
✅ **Discovery runs are idempotent**
✅ **Silent on duplicates (no errors)**
✅ **Normalized name computed before insert**
✅ **Update logic only references existing columns**
✅ **TypeScript strict mode maintained**

The system now allows running `npm run discover` multiple times for the same dataset with **ZERO errors**.
