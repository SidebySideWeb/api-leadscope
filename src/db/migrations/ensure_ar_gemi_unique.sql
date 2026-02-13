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

-- Drop existing partial index if it exists (we'll create a proper constraint)
DROP INDEX IF EXISTS businesses_ar_gemi_unique;

-- Drop any existing constraint with this name
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_ar_gemi_unique;

-- Create a proper unique constraint (not a partial index)
-- PostgreSQL allows multiple NULLs in unique constraints, so this is safe
-- This allows ON CONFLICT (ar_gemi) to work properly
ALTER TABLE businesses 
ADD CONSTRAINT businesses_ar_gemi_unique 
UNIQUE (ar_gemi);

-- Also create a regular index for query performance (non-unique)
CREATE INDEX IF NOT EXISTS idx_businesses_ar_gemi 
ON businesses(ar_gemi) 
WHERE ar_gemi IS NOT NULL;
