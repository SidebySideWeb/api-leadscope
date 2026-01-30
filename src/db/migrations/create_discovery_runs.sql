-- Create discovery_runs table
-- This table tracks discovery runs as the orchestration layer

CREATE TABLE IF NOT EXISTS discovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_discovery_runs_dataset_id ON discovery_runs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_status ON discovery_runs(status);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_created_at ON discovery_runs(created_at DESC);

-- Add discovery_run_id to businesses table
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS discovery_run_id UUID REFERENCES discovery_runs(id) ON DELETE SET NULL;

-- Add index for discovery_run_id lookups
CREATE INDEX IF NOT EXISTS idx_businesses_discovery_run_id ON businesses(discovery_run_id);

-- Add discovery_run_id to extraction_jobs table
ALTER TABLE extraction_jobs
ADD COLUMN IF NOT EXISTS discovery_run_id UUID REFERENCES discovery_runs(id) ON DELETE SET NULL;

-- Add index for discovery_run_id lookups
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_discovery_run_id ON extraction_jobs(discovery_run_id);
