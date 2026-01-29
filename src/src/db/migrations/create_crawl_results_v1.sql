-- Create crawl_results table for Crawl Worker v1
-- Stores crawl results with contacts, social links, and errors

CREATE TABLE IF NOT EXISTS crawl_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  dataset_id UUID NOT NULL,
  website_url TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  pages_visited INTEGER NOT NULL DEFAULT 0,
  crawl_status TEXT NOT NULL CHECK (crawl_status IN ('not_crawled', 'partial', 'completed')),
  emails JSONB NOT NULL DEFAULT '[]',
  phones JSONB NOT NULL DEFAULT '[]',
  contact_pages TEXT[] NOT NULL DEFAULT '[]',
  social JSONB NOT NULL DEFAULT '{}',
  errors JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, dataset_id)
);

CREATE INDEX IF NOT EXISTS idx_crawl_results_dataset ON crawl_results(dataset_id);
CREATE INDEX IF NOT EXISTS idx_crawl_results_business ON crawl_results(business_id);
CREATE INDEX IF NOT EXISTS idx_crawl_results_status ON crawl_results(crawl_status);

COMMENT ON TABLE crawl_results IS 'Crawl results from Crawl Worker v1';
COMMENT ON COLUMN crawl_results.emails IS 'Array of {value, source_url, context?} objects';
COMMENT ON COLUMN crawl_results.phones IS 'Array of {value, source_url} objects';
COMMENT ON COLUMN crawl_results.social IS 'Object with facebook, instagram, linkedin, twitter, youtube keys';
COMMENT ON COLUMN crawl_results.errors IS 'Array of {url, message} objects';
