-- Ensure ar_gemi has a proper unique constraint for ON CONFLICT to work
-- This is a more robust version that handles all edge cases

-- Ensure the column exists first
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'ar_gemi'
  ) THEN
    ALTER TABLE businesses ADD COLUMN ar_gemi VARCHAR(50);
  END IF;
END $$;

-- IMPORTANT: Drop constraint FIRST (it may own the index), then drop index
-- Drop any existing constraint with this name (CASCADE will drop dependent index)
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_ar_gemi_unique CASCADE;

-- Drop existing index if it still exists (in case it wasn't owned by constraint)
DROP INDEX IF EXISTS businesses_ar_gemi_unique;

-- Create a proper unique constraint (not a partial index)
-- PostgreSQL allows multiple NULLs in unique constraints, so this is safe
-- This allows ON CONFLICT (ar_gemi) to work properly
DO $$
BEGIN
  -- Check if unique constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'businesses_ar_gemi_unique' 
    AND conrelid = 'businesses'::regclass
  ) THEN
    ALTER TABLE businesses 
    ADD CONSTRAINT businesses_ar_gemi_unique 
    UNIQUE (ar_gemi);
    
    RAISE NOTICE 'Created unique constraint businesses_ar_gemi_unique on ar_gemi';
  ELSE
    RAISE NOTICE 'Unique constraint businesses_ar_gemi_unique already exists';
  END IF;
END $$;

-- Also create a regular index for query performance (non-unique)
CREATE INDEX IF NOT EXISTS idx_businesses_ar_gemi 
ON businesses(ar_gemi) 
WHERE ar_gemi IS NOT NULL;
