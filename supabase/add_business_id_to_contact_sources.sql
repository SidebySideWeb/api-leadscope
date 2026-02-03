-- ============================================================================
-- Add business_id column to contact_sources table
-- ============================================================================
-- This allows direct linking of contacts to businesses without joining through websites
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Step 1: Add business_id column (nullable, as existing records may not have it)
-- Note: businesses.id is UUID, so business_id must also be UUID
ALTER TABLE contact_sources 
ADD COLUMN IF NOT EXISTS business_id UUID;

-- Step 2: Add foreign key constraint to businesses table
-- This ensures data integrity: business_id must reference a valid business
-- Note: Drop constraint first if it exists, then add it
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'fk_contact_sources_business_id'
  ) THEN
    ALTER TABLE contact_sources DROP CONSTRAINT fk_contact_sources_business_id;
  END IF;
END $$;

ALTER TABLE contact_sources
ADD CONSTRAINT fk_contact_sources_business_id 
FOREIGN KEY (business_id) 
REFERENCES businesses(id) 
ON DELETE CASCADE;

-- Step 3: Create index for faster lookups
-- This significantly improves query performance when filtering by business_id
CREATE INDEX IF NOT EXISTS idx_contact_sources_business_id 
ON contact_sources(business_id);

-- Step 4: Add comment for documentation
COMMENT ON COLUMN contact_sources.business_id IS 'Direct link to business. Allows efficient querying of contacts by business without joining through websites.';

-- Step 5: Backfill existing data by matching through websites
-- This populates business_id for existing contact_sources records
UPDATE contact_sources cs
SET business_id = w.business_id
FROM websites w
WHERE cs.business_id IS NULL
  AND (
    cs.source_url LIKE '%' || REPLACE(REPLACE(w.url, 'https://', ''), 'http://', '') || '%'
    OR cs.source_url = w.url
    OR cs.source_url LIKE w.url || '%'
    OR REPLACE(REPLACE(cs.source_url, 'https://', ''), 'http://', '') = REPLACE(REPLACE(w.url, 'https://', ''), 'http://', '')
  );

-- Step 6: Show summary of backfill results
SELECT 
  COUNT(*) as total_contact_sources,
  COUNT(business_id) as with_business_id,
  COUNT(*) - COUNT(business_id) as without_business_id,
  ROUND(100.0 * COUNT(business_id) / COUNT(*), 2) as percentage_populated
FROM contact_sources;

-- ============================================================================
-- Notes:
-- ============================================================================
-- - Records without business_id will still work via fallback join in queries
-- - New contact_sources will automatically include business_id when created
-- - Foreign key ensures data integrity (can't reference non-existent business)
-- - CASCADE delete means if a business is deleted, its contact_sources are too
-- ============================================================================
