-- Add unique constraint on google_place_id to prevent duplicates
-- This allows ON CONFLICT DO NOTHING to work properly

-- First, remove any duplicate google_place_ids (keep the first one)
DELETE FROM businesses b1
WHERE EXISTS (
  SELECT 1 FROM businesses b2
  WHERE b2.google_place_id = b1.google_place_id
    AND b2.google_place_id IS NOT NULL
    AND b2.id < b1.id
);

-- Add unique constraint
ALTER TABLE businesses
ADD CONSTRAINT unique_google_place_id
UNIQUE (google_place_id);

-- Add index for faster lookups (unique constraint already creates an index, but explicit is clearer)
CREATE INDEX IF NOT EXISTS idx_businesses_google_place_id ON businesses(google_place_id)
WHERE google_place_id IS NOT NULL;
