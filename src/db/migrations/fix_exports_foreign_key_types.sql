-- Fix exports.city_id and exports.industry_id to use UUID instead of INTEGER
-- This matches the actual schema where cities.id and industries.id are UUID

-- Step 1: Drop existing foreign key constraints
ALTER TABLE exports 
DROP CONSTRAINT IF EXISTS exports_city_id_fkey;

ALTER TABLE exports 
DROP CONSTRAINT IF EXISTS exports_industry_id_fkey;

-- Step 2: Drop indexes that depend on these columns
DROP INDEX IF EXISTS idx_exports_industry_city;

-- Step 3: Convert columns from INTEGER to UUID
ALTER TABLE exports
ALTER COLUMN city_id TYPE uuid USING 
  CASE 
    WHEN city_id IS NULL THEN NULL::uuid
    ELSE (
      SELECT c.id 
      FROM cities c 
      WHERE c.id::text = city_id::text 
      LIMIT 1
    )
  END;

ALTER TABLE exports
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
ALTER TABLE exports
ADD CONSTRAINT exports_city_id_fkey 
FOREIGN KEY (city_id) REFERENCES cities(id);

ALTER TABLE exports
ADD CONSTRAINT exports_industry_id_fkey 
FOREIGN KEY (industry_id) REFERENCES industries(id);

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_exports_industry_city 
  ON exports(industry_id, city_id);
