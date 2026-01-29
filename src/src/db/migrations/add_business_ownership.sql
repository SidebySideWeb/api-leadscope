-- Add dataset_id and owner_user_id to businesses table
-- This enforces dataset and user ownership at the application level

ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS dataset_id INTEGER REFERENCES datasets(id),
ADD COLUMN IF NOT EXISTS owner_user_id VARCHAR(255) NOT NULL;

-- Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_businesses_dataset_id ON businesses(dataset_id);
CREATE INDEX IF NOT EXISTS idx_businesses_owner_user_id ON businesses(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_businesses_dataset_user ON businesses(dataset_id, owner_user_id);

-- Add composite index for deduplication within dataset
CREATE INDEX IF NOT EXISTS idx_businesses_place_id_dataset ON businesses(google_place_id, dataset_id) 
  WHERE google_place_id IS NOT NULL;
