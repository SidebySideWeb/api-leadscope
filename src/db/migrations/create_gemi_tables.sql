-- GEMI API Integration Tables
-- Creates tables for prefectures, municipalities, industries, and updates businesses table

-- Prefectures (Regions) table
CREATE TABLE IF NOT EXISTS prefectures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gemi_id INTEGER UNIQUE NOT NULL, -- GEMI API prefecture ID
  name VARCHAR(255) NOT NULL,
  name_el VARCHAR(255), -- Greek name
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Municipalities (Towns) table
CREATE TABLE IF NOT EXISTS municipalities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gemi_id INTEGER UNIQUE NOT NULL, -- GEMI API municipality ID
  prefecture_id UUID REFERENCES prefectures(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  name_el VARCHAR(255), -- Greek name
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Industries (Activities) table - update existing or create
-- Check if industries table exists and has gemi_id column
DO $$
BEGIN
  -- Add gemi_id to industries if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'industries' AND column_name = 'gemi_id'
  ) THEN
    ALTER TABLE industries ADD COLUMN gemi_id INTEGER UNIQUE;
  END IF;
END $$;

-- Update businesses table to add ar_gemi unique constraint and municipality/prefecture references
DO $$
BEGIN
  -- Add ar_gemi column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'ar_gemi'
  ) THEN
    ALTER TABLE businesses ADD COLUMN ar_gemi VARCHAR(50) UNIQUE;
  END IF;

  -- Add municipality_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'municipality_id'
  ) THEN
    ALTER TABLE businesses ADD COLUMN municipality_id UUID REFERENCES municipalities(id) ON DELETE SET NULL;
  END IF;

  -- Add prefecture_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'prefecture_id'
  ) THEN
    ALTER TABLE businesses ADD COLUMN prefecture_id UUID REFERENCES prefectures(id) ON DELETE SET NULL;
  END IF;

  -- Add website_url from GEMI if it doesn't exist (separate from websites table)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'website_url'
  ) THEN
    ALTER TABLE businesses ADD COLUMN website_url VARCHAR(500);
  END IF;
END $$;

-- Create unique index on ar_gemi if it doesn't exist
CREATE UNIQUE INDEX IF NOT EXISTS businesses_ar_gemi_unique ON businesses(ar_gemi) WHERE ar_gemi IS NOT NULL;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_municipalities_prefecture_id ON municipalities(prefecture_id);
CREATE INDEX IF NOT EXISTS idx_businesses_municipality_id ON businesses(municipality_id);
CREATE INDEX IF NOT EXISTS idx_businesses_prefecture_id ON businesses(prefecture_id);
CREATE INDEX IF NOT EXISTS idx_businesses_ar_gemi ON businesses(ar_gemi) WHERE ar_gemi IS NOT NULL;

-- Add comments
COMMENT ON TABLE prefectures IS 'GEMI API prefectures (regions) metadata';
COMMENT ON TABLE municipalities IS 'GEMI API municipalities (towns) metadata';
COMMENT ON COLUMN businesses.ar_gemi IS 'GEMI API unique business identifier (AR number)';
COMMENT ON COLUMN businesses.municipality_id IS 'Reference to municipality from GEMI API';
COMMENT ON COLUMN businesses.prefecture_id IS 'Reference to prefecture from GEMI API';
COMMENT ON COLUMN businesses.website_url IS 'Website URL from GEMI API data';
