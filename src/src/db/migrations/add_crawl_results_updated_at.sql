-- Add updated_at column to crawl_results table if it doesn't exist
-- This column tracks when crawl results were last updated

ALTER TABLE crawl_results
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create index on updated_at for efficient queries
CREATE INDEX IF NOT EXISTS idx_crawl_results_updated_at ON crawl_results(updated_at);

COMMENT ON COLUMN crawl_results.updated_at IS 'Timestamp when the crawl result was last updated';
