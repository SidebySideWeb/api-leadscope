-- Fix businesses table schema
-- Ensure created_at and updated_at exist
-- Ensure normalized_name is NOT NULL
-- Add unique constraint on (dataset_id, normalized_name)

-- Add created_at if missing
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Add updated_at if missing
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Ensure normalized_name is NOT NULL
-- First, set any NULL values to empty string (will be caught by validation)
UPDATE businesses
SET normalized_name = ''
WHERE normalized_name IS NULL;

-- Now make it NOT NULL
ALTER TABLE businesses
ALTER COLUMN normalized_name SET NOT NULL;

-- Add unique constraint on (dataset_id, normalized_name)
-- This allows ON CONFLICT to work for duplicate handling
-- First, remove any duplicates (keep the first one)
DELETE FROM businesses b1
WHERE EXISTS (
  SELECT 1 FROM businesses b2
  WHERE b2.dataset_id = b1.dataset_id
    AND b2.normalized_name = b1.normalized_name
    AND b2.id < b1.id
);

-- Add unique constraint
ALTER TABLE businesses
ADD CONSTRAINT unique_business_dataset_name
UNIQUE (dataset_id, normalized_name);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_businesses_dataset_normalized_name 
ON businesses(dataset_id, normalized_name);

-- Add trigger to automatically update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_businesses_updated_at ON businesses;
CREATE TRIGGER update_businesses_updated_at
BEFORE UPDATE ON businesses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
