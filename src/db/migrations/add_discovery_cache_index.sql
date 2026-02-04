-- Add index for discovery cache lookups
-- This improves performance when checking for cached businesses by industry + city
-- Used by getCachedBusinesses() function

CREATE INDEX IF NOT EXISTS idx_businesses_industry_city_cache 
ON businesses(industry_id, city_id) 
WHERE google_place_id IS NOT NULL;

-- Add comment explaining the index purpose
COMMENT ON INDEX idx_businesses_industry_city_cache IS 
'Index for discovery cache lookups. Speeds up queries for businesses by industry_id + city_id when checking cache before calling Google Maps API.';
