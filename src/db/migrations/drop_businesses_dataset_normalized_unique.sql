-- Drop the businesses_dataset_normalized_unique constraint
-- This constraint prevents multiple businesses with the same normalized_name in the same dataset
-- Removing it to allow duplicate business names within a dataset

-- Drop the unique constraint (try both possible names)
ALTER TABLE businesses 
DROP CONSTRAINT IF EXISTS businesses_dataset_normalized_unique;

ALTER TABLE businesses 
DROP CONSTRAINT IF EXISTS unique_business_dataset_name;

-- Note: The index idx_businesses_dataset_normalized_name will remain for query performance
-- but it won't enforce uniqueness anymore
