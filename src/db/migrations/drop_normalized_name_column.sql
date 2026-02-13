-- Completely remove normalized_name column from businesses table
-- This column is not needed for GEMI-based discovery

-- First, find and drop any triggers that might reference normalized_name
-- Check for triggers that might set normalized_name automatically
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Drop all triggers on businesses table that might reference normalized_name
    FOR r IN 
        SELECT trigger_name 
        FROM information_schema.triggers 
        WHERE event_object_table = 'businesses'
        AND action_statement LIKE '%normalized_name%'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON businesses CASCADE', r.trigger_name);
    END LOOP;
END $$;

-- Drop any functions that compute normalized_name
DROP FUNCTION IF EXISTS compute_normalized_name(TEXT) CASCADE;

-- Drop the check constraint on normalized_name
ALTER TABLE businesses 
DROP CONSTRAINT IF EXISTS businesses_normalized_name_not_empty;

-- Drop the unique constraint/index on (dataset_id, normalized_name) if it still exists
ALTER TABLE businesses 
DROP CONSTRAINT IF EXISTS businesses_dataset_normalized_unique CASCADE;

DROP INDEX IF EXISTS idx_businesses_dataset_normalized_name;

-- Finally, drop the column itself (CASCADE will drop dependent objects)
ALTER TABLE businesses 
DROP COLUMN IF EXISTS normalized_name CASCADE;
