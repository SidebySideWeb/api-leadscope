# Database Schema Inconsistencies Found

## ✅ UPDATE: Schema Verification Results

**Good News!** After running `verify_schema_types.sql`, all columns are correctly typed as `uuid`:

| Table | Column | Actual Type | References | Referenced Type | Status |
|-------|--------|-------------|------------|-----------------|--------|
| `datasets` | `city_id` | `uuid` | `cities.id` | `uuid` | ✅ **CORRECT** |
| `datasets` | `industry_id` | `uuid` | `industries.id` | `uuid` | ✅ **CORRECT** |
| `businesses` | `city_id` | `uuid` | `cities.id` | `uuid` | ✅ Correct |
| `businesses` | `industry_id` | `uuid` | `industries.id` | `uuid` | ✅ Correct |
| `exports` | `city_id` | `uuid` | `cities.id` | `uuid` | ✅ Correct |
| `exports` | `industry_id` | `uuid` | `industries.id` | `uuid` | ✅ Correct |

**Conclusion**: The migration files (`add_dataset_reuse_fields.sql` and `create_exports_table.sql`) are **outdated** and don't match the actual database schema. The database schema is correct - all foreign keys are properly typed as `uuid`.

## Previous Analysis (Based on Migration Files)

### Problem (Now Resolved)

The migration files incorrectly defined foreign keys as `INTEGER`, but the actual database schema uses `uuid` correctly.

### Root Cause

The migration file `add_dataset_reuse_fields.sql` incorrectly defines:
```sql
ALTER TABLE datasets
ADD COLUMN IF NOT EXISTS city_id INTEGER REFERENCES cities(id);
ADD COLUMN IF NOT EXISTS industry_id INTEGER REFERENCES industries(id);
```

But `cities.id` and `industries.id` are `uuid` type, not `INTEGER`.

### Impact

1. **Foreign Key Constraint Violation**: PostgreSQL may reject the foreign key constraint or it may not work correctly
2. **Query Issues**: The code has to cast `city_id::text` and `industry_id::text` to handle the mismatch
3. **Data Integrity**: Cannot properly enforce referential integrity
4. **Join Performance**: Type mismatches can cause slow joins

### Current Workaround in Code

The code currently handles this by casting to text:
```sql
d.city_id::text as city_id,
d.industry_id::text as industry_id,
```

And then doing string comparisons when looking up names:
```typescript
const industryIdStr = String(row.industry_id);
industryName = industryMap.get(industryIdStr) || 'Unknown';
```

This works but is inefficient and error-prone.

## Other Schema Observations

### ✅ Correct Relationships

1. **contacts → contact_sources → businesses**: 
   - `contacts` table has no `business_id` (correct)
   - `contact_sources` links them via `contact_id` and `business_id` (correct)
   - Our recent fix correctly uses this relationship

2. **users → datasets**:
   - `datasets.user_id` → `users.id` (both `uuid`, correct)

3. **datasets → businesses**:
   - `businesses.dataset_id` → `datasets.id` (both `uuid`, correct)

### ⚠️ Potential Issues

1. **exports table**: According to migration `create_exports_table.sql`, it also uses `INTEGER` for `city_id` and `industry_id`, but the schema diagram shows `uuid`. Need to verify actual schema.

2. **Type consistency**: All ID columns should be `uuid` for consistency across the schema.

## Recommended Fix

### Migration to Fix Type Mismatch

Create a new migration file: `fix_datasets_foreign_key_types.sql`

```sql
-- Fix datasets.city_id and datasets.industry_id to match referenced types

-- Step 1: Drop existing foreign key constraints
ALTER TABLE datasets 
DROP CONSTRAINT IF EXISTS datasets_city_id_fkey;

ALTER TABLE datasets 
DROP CONSTRAINT IF EXISTS datasets_industry_id_fkey;

-- Step 2: Convert columns to UUID type
-- First, ensure all values can be converted (they should be NULL or valid UUIDs)
-- If there are INTEGER values, they need to be mapped to UUIDs first

-- Convert city_id from INTEGER to UUID
ALTER TABLE datasets
ALTER COLUMN city_id TYPE uuid USING 
  CASE 
    WHEN city_id IS NULL THEN NULL
    -- If city_id is an integer, we need to find the corresponding UUID
    -- This assumes cities.id was originally INTEGER and migrated to UUID
    ELSE (SELECT id FROM cities WHERE id::text = city_id::text LIMIT 1)
  END;

-- Convert industry_id from INTEGER to UUID
ALTER TABLE datasets
ALTER COLUMN industry_id TYPE uuid USING 
  CASE 
    WHEN industry_id IS NULL THEN NULL
    ELSE (SELECT id FROM industries WHERE id::text = industry_id::text LIMIT 1)
  END;

-- Step 3: Re-add foreign key constraints with correct types
ALTER TABLE datasets
ADD CONSTRAINT datasets_city_id_fkey 
FOREIGN KEY (city_id) REFERENCES cities(id);

ALTER TABLE datasets
ADD CONSTRAINT datasets_industry_id_fkey 
FOREIGN KEY (industry_id) REFERENCES industries(id);

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_datasets_city_industry 
  ON datasets(city_id, industry_id) 
  WHERE city_id IS NOT NULL AND industry_id IS NOT NULL;
```

### Alternative: If cities/industries IDs are actually INTEGER

If `cities.id` and `industries.id` are actually `INTEGER` in your database (not `uuid` as shown in schema diagram), then:

1. The migration is correct
2. But `businesses.city_id` and `businesses.industry_id` being `uuid` is wrong
3. Need to verify actual database schema

## Verification Steps

1. **Check actual database schema**:
```sql
-- Check cities table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'cities' AND column_name = 'id';

-- Check industries table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'industries' AND column_name = 'id';

-- Check datasets table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'datasets' 
AND column_name IN ('city_id', 'industry_id');

-- Check businesses table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'businesses' 
AND column_name IN ('city_id', 'industry_id');
```

2. **Check foreign key constraints**:
```sql
SELECT
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    tc.constraint_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name IN ('datasets', 'businesses', 'exports')
  AND kcu.column_name IN ('city_id', 'industry_id');
```

## Action Items

1. ✅ **Fixed**: Contacts join (now uses `contact_sources` table)
2. ⚠️ **Needs Fix**: `datasets.city_id` and `datasets.industry_id` type mismatch
3. ⚠️ **Needs Verification**: Actual database schema vs. diagram
4. ⚠️ **Needs Review**: `exports` table foreign key types

## Code Changes Needed After Schema Fix

Once the schema is fixed, we can simplify the code:

**Before (current workaround)**:
```typescript
d.city_id::text as city_id,
d.industry_id::text as industry_id,
// ... then string comparison
const industryIdStr = String(row.industry_id);
industryName = industryMap.get(industryIdStr) || 'Unknown';
```

**After (simplified)**:
```typescript
d.city_id,
d.industry_id,
// ... direct UUID comparison
industryName = industryMap.get(row.industry_id) || 'Unknown';
```

This will improve:
- Query performance (no casting needed)
- Code clarity (direct type matching)
- Data integrity (proper foreign keys)
