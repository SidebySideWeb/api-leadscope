-- Remove normalized_name requirement and make it optional
-- This field is not needed for GEMI-based discovery

-- Drop the NOT NULL constraint on normalized_name
ALTER TABLE businesses 
ALTER COLUMN normalized_name DROP NOT NULL;

-- Drop the check constraint that requires normalized_name to be non-empty
ALTER TABLE businesses 
DROP CONSTRAINT IF EXISTS businesses_normalized_name_not_empty;

-- Note: We keep the column for backward compatibility but it's no longer required
-- If you want to completely remove it later, you can:
-- ALTER TABLE businesses DROP COLUMN IF EXISTS normalized_name;
