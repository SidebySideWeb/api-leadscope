# Fix: ON CONFLICT Error for extraction_jobs

## Problem
Error: `there is no unique or exclusion constraint matching the ON CONFLICT specification`

This happens because the code uses:
```sql
ON CONFLICT (business_id) DO NOTHING
```

But the `extraction_jobs` table doesn't have a unique constraint on `business_id`.

## Solution

Run this SQL in Supabase SQL Editor:

```sql
-- Clean up any duplicate business_ids first
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
    RAISE NOTICE 'Found % duplicate business_ids. Cleaning up...', duplicate_count;
    
    -- Keep the oldest extraction job for each business_id
    DELETE FROM extraction_jobs ej
    WHERE ej.id NOT IN (
      SELECT MIN(id)
      FROM extraction_jobs
      GROUP BY business_id
    );
  END IF;
END $$;

-- Add unique constraint
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_extraction_jobs_business_id'
  ) THEN
    ALTER TABLE extraction_jobs DROP CONSTRAINT unique_extraction_jobs_business_id;
  END IF;
END $$;

ALTER TABLE extraction_jobs
ADD CONSTRAINT unique_extraction_jobs_business_id 
UNIQUE (business_id);
```

## What This Does

1. **Cleans up duplicates**: Removes any duplicate extraction jobs (keeps the oldest one)
2. **Adds unique constraint**: Ensures each business can only have one extraction job
3. **Fixes ON CONFLICT**: Allows `ON CONFLICT (business_id) DO NOTHING` to work correctly

## After Running

The error should be resolved and extraction jobs will be created correctly without duplicates.
