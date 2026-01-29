-- Add job_type to crawl_jobs table
-- job_type: 'discovery' | 'refresh'

ALTER TABLE crawl_jobs
ADD COLUMN IF NOT EXISTS job_type VARCHAR(20) DEFAULT 'discovery'
  CHECK (job_type IN ('discovery', 'refresh'));

-- Add index for filtering by job type
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_job_type ON crawl_jobs(job_type);

-- Add contact lifecycle tracking fields
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Add index for active contacts
CREATE INDEX IF NOT EXISTS idx_contacts_is_active ON contacts(is_active) WHERE is_active = TRUE;

-- Add index for refresh queries (last_verified_at)
CREATE INDEX IF NOT EXISTS idx_contacts_last_verified ON contacts(last_verified_at);
