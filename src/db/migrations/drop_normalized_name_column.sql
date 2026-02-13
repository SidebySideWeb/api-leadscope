-- Completely remove normalized_name column from businesses table
-- This column is not needed for GEMI-based discovery

-- Drop any triggers that might reference normalized_name
DROP TRIGGER IF EXISTS update_businesses_normalized_name ON businesses;

-- Drop any functions that compute normalized_name
DROP FUNCTION IF EXISTS compute_normalized_name(TEXT);

-- Drop the check constraint on normalized_name
ALTER TABLE businesses 
DROP CONSTRAINT IF EXISTS businesses_normalized_name_not_empty;

-- Drop the unique constraint/index on (dataset_id, normalized_name) if it still exists
ALTER TABLE businesses 
DROP CONSTRAINT IF EXISTS businesses_dataset_normalized_unique;

DROP INDEX IF EXISTS idx_businesses_dataset_normalized_name;

-- Finally, drop the column itself
ALTER TABLE businesses 
DROP COLUMN IF EXISTS normalized_name;
