-- Add cost_estimates column to discovery_runs table
-- This column stores cost estimation data as JSON (ESTIMATES ONLY - no billing occurs)

ALTER TABLE discovery_runs
ADD COLUMN IF NOT EXISTS cost_estimates JSONB;

-- Add comment explaining this is estimation only
COMMENT ON COLUMN discovery_runs.cost_estimates IS 'Cost estimation data (JSON). ESTIMATES ONLY - no billing occurs during discovery. Used for preview/estimation purposes.';
