-- Add fields to datasets table for reuse logic
-- city_id, industry_id, last_refreshed_at

-- Add city_id (references cities table)
ALTER TABLE datasets
ADD COLUMN IF NOT EXISTS city_id INTEGER REFERENCES cities(id);

-- Add industry_id (references industries table)
ALTER TABLE datasets
ADD COLUMN IF NOT EXISTS industry_id INTEGER REFERENCES industries(id);

-- Add last_refreshed_at timestamp
ALTER TABLE datasets
ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ;

-- Add index for fast lookups by city and industry
CREATE INDEX IF NOT EXISTS idx_datasets_city_industry 
  ON datasets(city_id, industry_id) 
  WHERE city_id IS NOT NULL AND industry_id IS NOT NULL;

-- Add index for last_refreshed_at queries
CREATE INDEX IF NOT EXISTS idx_datasets_last_refreshed 
  ON datasets(last_refreshed_at) 
  WHERE last_refreshed_at IS NOT NULL;

-- Add comment
COMMENT ON COLUMN datasets.city_id IS 'City ID for dataset reuse logic';
COMMENT ON COLUMN datasets.industry_id IS 'Industry ID for dataset reuse logic';
COMMENT ON COLUMN datasets.last_refreshed_at IS 'Last refresh timestamp for dataset reuse logic (reuse if < 30 days)';
