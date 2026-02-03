-- Migration: Add business_id column to contact_sources table
-- This allows direct linking of contacts to businesses without joining through websites
-- Date: 2025-01-XX

-- Add business_id column (nullable, as existing records may not have it)
ALTER TABLE contact_sources 
ADD COLUMN IF NOT EXISTS business_id INTEGER;

-- Add foreign key constraint to businesses table
ALTER TABLE contact_sources
ADD CONSTRAINT fk_contact_sources_business_id 
FOREIGN KEY (business_id) 
REFERENCES businesses(id) 
ON DELETE CASCADE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_contact_sources_business_id 
ON contact_sources(business_id);

-- Add comment
COMMENT ON COLUMN contact_sources.business_id IS 'Direct link to business. Allows efficient querying of contacts by business without joining through websites.';
