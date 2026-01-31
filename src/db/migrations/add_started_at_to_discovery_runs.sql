-- Add started_at column to discovery_runs table
-- This tracks when discovery execution actually began (not just when record was created)

ALTER TABLE discovery_runs
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- Add index for started_at queries
CREATE INDEX IF NOT EXISTS idx_discovery_runs_started_at ON discovery_runs(started_at);
