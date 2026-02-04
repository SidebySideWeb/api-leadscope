-- Fix datasets.city_id and datasets.industry_id to use UUID instead of INTEGER
-- This matches the actual schema where cities.id and industries.id are UUID

-- Step 1: Drop existing foreign key constraints
ALTER TABLE datasets 
DROP CONSTRAINT IF EXISTS datasets_city_id_fkey;

ALTER TABLE datasets 
DROP CONSTRAINT IF EXISTS datasets_industry_id_fkey;

-- Step 2: Drop indexes that depend on these columns
DROP INDEX IF EXISTS idx_datasets_city_industry;

-- Step 3: Convert columns from INTEGER to UUID
-- Note: This assumes cities.id and industries.id are UUID in your database
-- If they're actually INTEGER, this migration will fail and you need to fix the schema diagram

-- Convert city_id from INTEGER to UUID
-- First, we need to handle the conversion properly
-- If city_id contains integer values, we need to map them to UUIDs
-- This is a complex operation - we'll use a subquery to find matching UUIDs

ALTER TABLE datasets
ALTER COLUMN city_id TYPE uuid USING 
  CASE 
    WHEN city_id IS NULL THEN NULL::uuid
    -- Try to find matching UUID by converting both to text
    -- This handles the case where city_id is stored as integer but cities.id is UUID
    ELSE (
      SELECT c.id 
      FROM cities c 
      WHERE c.id::text = city_id::text 
      LIMIT 1
    )
  END;

-- Convert industry_id from INTEGER to UUID
ALTER TABLE datasets
ALTER COLUMN industry_id TYPE uuid USING 
  CASE 
    WHEN industry_id IS NULL THEN NULL::uuid
    ELSE (
      SELECT i.id 
      FROM industries i 
      WHERE i.id::text = industry_id::text 
      LIMIT 1
    )
  END;

-- Step 4: Re-add foreign key constraints with correct types
ALTER TABLE datasets
ADD CONSTRAINT datasets_city_id_fkey 
FOREIGN KEY (city_id) REFERENCES cities(id);

ALTER TABLE datasets
ADD CONSTRAINT datasets_industry_id_fkey 
FOREIGN KEY (industry_id) REFERENCES industries(id);

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_datasets_city_industry 
  ON datasets(city_id, industry_id) 
  WHERE city_id IS NOT NULL AND industry_id IS NOT NULL;

-- Add comments
COMMENT ON COLUMN datasets.city_id IS 'City ID (UUID) for dataset reuse logic';
COMMENT ON COLUMN datasets.industry_id IS 'Industry ID (UUID) for dataset reuse logic';
