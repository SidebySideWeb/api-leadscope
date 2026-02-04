-- Migration: Upgrade businesses table to support shared, reusable business intelligence
-- This transforms businesses from dataset-owned records to global, enriched assets
--
-- Key Changes:
-- 1. Make google_place_id unique globally (not per-dataset)
-- 2. Add enrichment tracking fields (lat, lng, website, phone, emails, social_links)
-- 3. Add data completeness and freshness tracking
-- 4. Add crawl status and TTL tracking
-- 5. Add indexes for performance

-- STEP 1: Add new enrichment fields
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS website TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS emails JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS data_completeness_score INTEGER DEFAULT 0 CHECK (data_completeness_score >= 0 AND data_completeness_score <= 100),
ADD COLUMN IF NOT EXISTS last_discovered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_crawled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS crawl_status TEXT DEFAULT 'pending' CHECK (crawl_status IN ('pending', 'success', 'failed', 'skipped'));

-- STEP 2: Make google_place_id unique globally (if not already unique)
-- Check if unique constraint already exists and handle duplicates
DO $unique_constraint$
BEGIN
  -- Check if unique constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_google_place_id'
  ) THEN
    -- Handle duplicates by keeping the oldest record
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
    
    RAISE NOTICE 'Added unique constraint on google_place_id';
  ELSE
    RAISE NOTICE 'Unique constraint on google_place_id already exists';
  END IF;
END $unique_constraint$;

-- Ensure index exists (unique constraint creates index, but explicit is clearer)
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_google_place_id_unique 
ON businesses(google_place_id) 
WHERE google_place_id IS NOT NULL;

-- STEP 3: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_businesses_city_id ON businesses(city_id);
CREATE INDEX IF NOT EXISTS idx_businesses_last_crawled_at ON businesses(last_crawled_at);
CREATE INDEX IF NOT EXISTS idx_businesses_crawl_status ON businesses(crawl_status);
CREATE INDEX IF NOT EXISTS idx_businesses_data_completeness ON businesses(data_completeness_score);
CREATE INDEX IF NOT EXISTS idx_businesses_last_discovered_at ON businesses(last_discovered_at);

-- STEP 4: Backfill existing data
-- Extract location from address if available (heuristic - will be updated by discovery)
-- Extract website from websites table
-- Extract phone and emails from contacts table
-- Note: businesses.id is UUID, contact_sources.business_id is also UUID, so direct match

UPDATE businesses b
SET 
  website = (
    SELECT w.url 
    FROM websites w 
    WHERE w.business_id = b.id 
    ORDER BY w.created_at DESC 
    LIMIT 1
  ),
  phone = (
    SELECT c.phone 
    FROM contacts c
    JOIN contact_sources cs ON cs.contact_id = c.id
    WHERE cs.business_id = b.id
      AND c.phone IS NOT NULL
    ORDER BY cs.found_at DESC
    LIMIT 1
  ),
  emails = (
    SELECT COALESCE(jsonb_agg(DISTINCT c.email), '[]'::jsonb)
    FROM contacts c
    JOIN contact_sources cs ON cs.contact_id = c.id
    WHERE cs.business_id = b.id
      AND c.email IS NOT NULL
  ),
  last_crawled_at = (
    SELECT MAX(w.last_crawled_at)
    FROM websites w
    WHERE w.business_id = b.id
  )
WHERE EXISTS (
  SELECT 1 FROM websites w WHERE w.business_id = b.id
) OR EXISTS (
  SELECT 1 FROM contact_sources cs 
  WHERE cs.business_id = b.id
);

-- STEP 5: Set initial crawl_status based on existing data
UPDATE businesses
SET crawl_status = CASE
  WHEN website IS NOT NULL AND last_crawled_at IS NOT NULL THEN 'success'
  WHEN website IS NOT NULL AND last_crawled_at IS NULL THEN 'pending'
  WHEN website IS NULL THEN 'skipped'
  ELSE 'pending'
END
WHERE crawl_status = 'pending';

-- STEP 6: Calculate initial data_completeness_score
-- Website: +40, Email: +30, Phone: +20, Address: +10
UPDATE businesses
SET data_completeness_score = (
  CASE WHEN website IS NOT NULL THEN 40 ELSE 0 END +
  CASE WHEN jsonb_array_length(emails) > 0 THEN 30 ELSE 0 END +
  CASE WHEN phone IS NOT NULL THEN 20 ELSE 0 END +
  CASE WHEN address IS NOT NULL THEN 10 ELSE 0 END
);

-- STEP 7: Set last_discovered_at for existing businesses
UPDATE businesses
SET last_discovered_at = created_at
WHERE last_discovered_at IS NULL;

-- Add comments for documentation
COMMENT ON COLUMN businesses.google_place_id IS 'Unique Google Place ID - businesses are deduplicated globally by this field';
COMMENT ON COLUMN businesses.latitude IS 'Business latitude from Google Places or geocoding';
COMMENT ON COLUMN businesses.longitude IS 'Business longitude from Google Places or geocoding';
COMMENT ON COLUMN businesses.website IS 'Primary website URL (from Google Places or crawling)';
COMMENT ON COLUMN businesses.phone IS 'Primary phone number (from Google Places or crawling)';
COMMENT ON COLUMN businesses.emails IS 'Array of email addresses found (JSONB)';
COMMENT ON COLUMN businesses.social_links IS 'Social media links (JSONB: {facebook, instagram, linkedin, etc})';
COMMENT ON COLUMN businesses.data_completeness_score IS 'Data completeness score 0-100 (website=40, email=30, phone=20, address=10)';
COMMENT ON COLUMN businesses.last_discovered_at IS 'Last time this business was discovered via Google Places API';
COMMENT ON COLUMN businesses.last_crawled_at IS 'Last time website was crawled for contacts';
COMMENT ON COLUMN businesses.crawl_status IS 'Crawl status: pending, success, failed, skipped';
