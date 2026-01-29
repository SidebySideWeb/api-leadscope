-- Create dataset_snapshots table for caching dataset exports
-- Snapshots expire after 30 days and can be reused for faster exports

CREATE TABLE IF NOT EXISTS dataset_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  snapshot_data JSONB NOT NULL,
  CONSTRAINT fk_dataset FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_dataset_snapshots_dataset_user 
  ON dataset_snapshots(dataset_id, user_id);

CREATE INDEX IF NOT EXISTS idx_dataset_snapshots_expires 
  ON dataset_snapshots(expires_at);

-- Add comment
COMMENT ON TABLE dataset_snapshots IS 'Cached dataset snapshots for faster exports. Expires after 30 days.';
