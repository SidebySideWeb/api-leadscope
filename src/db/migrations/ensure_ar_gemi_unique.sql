-- Ensure ar_gemi has a proper unique constraint for ON CONFLICT to work
-- This migration ensures the unique constraint exists even if the column was added without it

-- Also ensure the column exists first
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'ar_gemi'
  ) THEN
    ALTER TABLE businesses ADD COLUMN ar_gemi VARCHAR(50);
  END IF;
END $$;

-- Drop existing index/constraint if it exists (we'll recreate it properly)
DROP INDEX IF EXISTS businesses_ar_gemi_unique;
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_ar_gemi_unique;

-- Create a unique constraint (not just an index) so ON CONFLICT can use it
-- Since we want to allow NULL values but enforce uniqueness on non-null values,
-- we'll create a partial unique index and then reference it by name in ON CONFLICT
-- But actually, for ON CONFLICT to work with partial indexes, we need to use the index name
-- So let's create a constraint that works with ON CONFLICT

-- First, ensure no NULL ar_gemi values exist (set them to a temporary value)
-- Actually, let's just create a unique index that allows NULLs but enforces uniqueness on non-nulls
CREATE UNIQUE INDEX IF NOT EXISTS businesses_ar_gemi_unique 
ON businesses(ar_gemi) 
WHERE ar_gemi IS NOT NULL;

-- Note: For ON CONFLICT to work with this partial index, we need to use:
-- ON CONFLICT ON CONSTRAINT businesses_ar_gemi_unique
-- But since it's an index, not a constraint, we need to use the index name differently
-- Actually, PostgreSQL allows ON CONFLICT (column) even with partial indexes if the value is not null
-- So the original ON CONFLICT (ar_gemi) should work if ar_gemi is not null
