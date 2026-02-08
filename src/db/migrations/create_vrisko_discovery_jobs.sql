-- Create vrisko_discovery_jobs table for database-driven job queue
-- This enables concurrent processing, batching, and resumable jobs

CREATE TABLE IF NOT EXISTS vrisko_discovery_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  industry_id UUID NOT NULL REFERENCES industries(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  discovery_run_id UUID REFERENCES discovery_runs(id) ON DELETE SET NULL,
  
  -- Job status
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0, -- Higher priority processed first
  
  -- Progress tracking
  total_keywords INTEGER DEFAULT 0, -- Total keywords to search
  completed_keywords INTEGER DEFAULT 0, -- Keywords completed
  total_pages INTEGER DEFAULT 0, -- Total pages to crawl
  completed_pages INTEGER DEFAULT 0, -- Pages completed
  businesses_found INTEGER DEFAULT 0,
  businesses_created INTEGER DEFAULT 0,
  businesses_updated INTEGER DEFAULT 0,
  
  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  
  -- Timing
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  scheduled_at TIMESTAMP, -- For delayed execution
  
  -- Metadata
  metadata JSONB, -- Store additional job data (keywords, location, etc.)
  
  -- Constraints
  CONSTRAINT valid_progress CHECK (
    completed_keywords <= total_keywords AND
    completed_pages <= total_pages
  )
);

-- Indexes for efficient job querying
CREATE INDEX IF NOT EXISTS idx_vrisko_jobs_status ON vrisko_discovery_jobs(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_vrisko_jobs_city_industry ON vrisko_discovery_jobs(city_id, industry_id);
CREATE INDEX IF NOT EXISTS idx_vrisko_jobs_dataset ON vrisko_discovery_jobs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_vrisko_jobs_scheduled ON vrisko_discovery_jobs(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vrisko_jobs_user ON vrisko_discovery_jobs(user_id) WHERE user_id IS NOT NULL;

-- Index for finding jobs to process
CREATE INDEX IF NOT EXISTS idx_vrisko_jobs_pending ON vrisko_discovery_jobs(status, priority DESC, created_at ASC) 
  WHERE status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= NOW());

-- Comments
COMMENT ON TABLE vrisko_discovery_jobs IS 'Queue for vrisko.gr discovery jobs with concurrency and batching support';
COMMENT ON COLUMN vrisko_discovery_jobs.priority IS 'Higher priority jobs are processed first (default: 0)';
COMMENT ON COLUMN vrisko_discovery_jobs.metadata IS 'JSONB field for storing job-specific data (keywords, location string, etc.)';
