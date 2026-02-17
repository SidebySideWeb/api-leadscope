-- Add industry_group_id column to discovery_runs table
-- This column stores the industry group ID when discovery is run for an industry group
-- instead of a single industry

-- Add the column (nullable, since it's optional)
ALTER TABLE discovery_runs 
ADD COLUMN IF NOT EXISTS industry_group_id UUID NULL;

-- Add a comment to document the column
COMMENT ON COLUMN discovery_runs.industry_group_id IS 'UUID of the industry group used for discovery (alternative to industry_id via dataset)';

-- Add foreign key constraint to industry_groups table (if it exists)
-- Note: This will fail gracefully if industry_groups table doesn't exist yet
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'industry_groups') THEN
    ALTER TABLE discovery_runs 
    ADD CONSTRAINT IF NOT EXISTS discovery_runs_industry_group_id_fkey 
    FOREIGN KEY (industry_group_id) 
    REFERENCES industry_groups(id) 
    ON DELETE SET NULL;
  END IF;
END $$;
