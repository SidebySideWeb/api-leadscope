-- Fix crawl_jobs table schema
-- Add missing fields: pages_limit, update status values

-- Add pages_limit column (default 25)
ALTER TABLE crawl_jobs
ADD COLUMN IF NOT EXISTS pages_limit INTEGER DEFAULT 25;

-- Ensure pages_crawled exists and defaults to 0
ALTER TABLE crawl_jobs
ADD COLUMN IF NOT EXISTS pages_crawled INTEGER DEFAULT 0;

-- Update status values from 'in_progress' to 'running' if needed
-- First, update existing records
UPDATE crawl_jobs
SET status = 'running'
WHERE status = 'in_progress';

-- Update the check constraint to use 'running' instead of 'in_progress'
-- Drop old constraint if exists
ALTER TABLE crawl_jobs
DROP CONSTRAINT IF EXISTS crawl_jobs_status_check;

-- Add new constraint with 'running'
ALTER TABLE crawl_jobs
ADD CONSTRAINT crawl_jobs_status_check
CHECK (status IN ('pending', 'running', 'completed', 'failed'));

-- Ensure started_at and completed_at exist
ALTER TABLE crawl_jobs
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE crawl_jobs
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status ON crawl_jobs(status);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_started_at ON crawl_jobs(started_at);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_completed_at ON crawl_jobs(completed_at);
