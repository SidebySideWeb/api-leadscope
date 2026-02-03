-- ============================================================================
-- Add unique constraint on extraction_jobs.business_id
-- ============================================================================
-- This allows ON CONFLICT (business_id) DO NOTHING to work properly
-- Each business should have only one extraction job
-- ============================================================================

-- Step 1: Check if there are any duplicate business_ids
-- If there are, we need to clean them up first
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT business_id, COUNT(*) as cnt
    FROM extraction_jobs
    GROUP BY business_id
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_count > 0 THEN
    RAISE NOTICE 'Found % duplicate business_ids in extraction_jobs. Cleaning up...', duplicate_count;
    
    -- Keep the oldest extraction job for each business_id
    DELETE FROM extraction_jobs ej
    WHERE ej.id NOT IN (
      SELECT MIN(id)
      FROM extraction_jobs
      GROUP BY business_id
    );
    
    RAISE NOTICE 'Cleaned up duplicate extraction jobs';
  END IF;
END $$;

-- Step 2: Add unique constraint on business_id
-- Drop constraint first if it exists
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_extraction_jobs_business_id'
  ) THEN
    ALTER TABLE extraction_jobs DROP CONSTRAINT unique_extraction_jobs_business_id;
  END IF;
END $$;

-- Add unique constraint
ALTER TABLE extraction_jobs
ADD CONSTRAINT unique_extraction_jobs_business_id 
UNIQUE (business_id);

-- Step 3: Create index (unique constraint automatically creates an index, but explicit is clearer)
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_business_id 
ON extraction_jobs(business_id);

-- Step 4: Verify constraint was created
SELECT 
  constraint_name,
  constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'extraction_jobs'
  AND constraint_name = 'unique_extraction_jobs_business_id';

-- ============================================================================
-- Notes:
-- ============================================================================
-- - Each business can now have only one extraction job
-- - ON CONFLICT (business_id) DO NOTHING will work correctly
-- - This prevents duplicate extraction jobs for the same business
-- ============================================================================
