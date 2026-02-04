-- Migration: Create dataset_businesses junction table
-- This refactors datasets to reference businesses (views) instead of owning them
--
-- Key Changes:
-- 1. Create dataset_businesses table (many-to-many relationship)
-- 2. Migrate existing businesses.dataset_id relationships
-- 3. Add manual include/exclude and review status flags
-- 4. Keep businesses.dataset_id temporarily for backward compatibility (will be deprecated)

-- STEP 1: Create dataset_businesses junction table
CREATE TABLE IF NOT EXISTS dataset_businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Manual control flags
  manually_included BOOLEAN DEFAULT false,
  manually_excluded BOOLEAN DEFAULT false,
  review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected', 'flagged')),
  
  -- Metadata
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_by_user_id UUID, -- User who added this business to dataset
  notes TEXT, -- Optional notes about this business in this dataset
  
  -- Ensure unique (dataset, business) pairs
  CONSTRAINT unique_dataset_business UNIQUE (dataset_id, business_id)
);

-- STEP 2: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_dataset_businesses_dataset_id ON dataset_businesses(dataset_id);
CREATE INDEX IF NOT EXISTS idx_dataset_businesses_business_id ON dataset_businesses(business_id);
CREATE INDEX IF NOT EXISTS idx_dataset_businesses_review_status ON dataset_businesses(review_status);
CREATE INDEX IF NOT EXISTS idx_dataset_businesses_manually_excluded ON dataset_businesses(manually_excluded) WHERE manually_excluded = true;

-- STEP 3: Migrate existing businesses.dataset_id relationships to dataset_businesses
-- This preserves existing dataset-business relationships
INSERT INTO dataset_businesses (dataset_id, business_id, added_at, manually_included)
SELECT DISTINCT
  b.dataset_id,
  b.id,
  b.created_at,
  true -- Mark existing relationships as manually included
FROM businesses b
WHERE b.dataset_id IS NOT NULL
ON CONFLICT (dataset_id, business_id) DO NOTHING;

-- STEP 4: Add comments for documentation
COMMENT ON TABLE dataset_businesses IS 'Junction table linking datasets to businesses. Datasets are views over businesses, not data owners.';
COMMENT ON COLUMN dataset_businesses.manually_included IS 'True if user manually added this business to dataset';
COMMENT ON COLUMN dataset_businesses.manually_excluded IS 'True if user manually excluded this business from dataset';
COMMENT ON COLUMN dataset_businesses.review_status IS 'Review status: pending, approved, rejected, flagged';
COMMENT ON COLUMN dataset_businesses.added_by_user_id IS 'User who added this business to the dataset';
COMMENT ON COLUMN dataset_businesses.notes IS 'Optional notes about this business in this dataset context';
