-- Add latitude, longitude, and radius_km columns to cities table
-- These columns store the geographic center and search radius for each city

ALTER TABLE cities
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS radius_km DECIMAL(5, 2);

-- Add index for faster lookups by coordinates
CREATE INDEX IF NOT EXISTS idx_cities_coordinates ON cities(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
