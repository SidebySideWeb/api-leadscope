-- Remove normalized_name requirement and make it optional
-- This field is not needed for GEMI-based discovery
-- This migration is idempotent - it checks if the column exists first

-- Only modify normalized_name if it exists
DO $$
BEGIN
  -- Check if normalized_name column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'normalized_name'
  ) THEN
    -- Drop the NOT NULL constraint on normalized_name
    ALTER TABLE businesses 
    ALTER COLUMN normalized_name DROP NOT NULL;
    
    -- Drop the check constraint that requires normalized_name to be non-empty
    ALTER TABLE businesses 
    DROP CONSTRAINT IF EXISTS businesses_normalized_name_not_empty;
    
    RAISE NOTICE 'Removed NOT NULL constraint from normalized_name column';
  ELSE
    RAISE NOTICE 'normalized_name column does not exist, skipping migration';
  END IF;
END $$;
