-- Stabilize businesses table schema
-- Add updated_at if missing, ensure normalized_name has fallback

-- Add updated_at if missing
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Ensure normalized_name is NOT NULL
-- First, fix any NULL or empty values using SQL fallback
UPDATE businesses
SET normalized_name = lower(trim(regexp_replace(name, '\s+', ' ', 'g')))
WHERE normalized_name IS NULL OR normalized_name = '';

-- Now make it NOT NULL
ALTER TABLE businesses
ALTER COLUMN normalized_name SET NOT NULL;

-- Create a function to compute normalized_name as fallback
-- This ensures normalized_name is never empty at the database level
CREATE OR REPLACE FUNCTION compute_normalized_name(business_name TEXT)
RETURNS TEXT AS $$
BEGIN
  -- If normalization would result in empty, use SQL fallback
  RETURN lower(trim(regexp_replace(business_name, '\s+', ' ', 'g')));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add a check constraint to ensure normalized_name is never empty
ALTER TABLE businesses
DROP CONSTRAINT IF EXISTS businesses_normalized_name_not_empty;

ALTER TABLE businesses
ADD CONSTRAINT businesses_normalized_name_not_empty
CHECK (normalized_name IS NOT NULL AND length(trim(normalized_name)) > 0);
