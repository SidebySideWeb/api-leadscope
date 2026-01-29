-- Create crawl_results table to store HTML content from crawls
-- This table is needed for the extractor to access crawled content

CREATE TABLE IF NOT EXISTS crawl_results (
  id SERIAL PRIMARY KEY,
  crawl_job_id UUID NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  html TEXT NOT NULL,
  html_hash VARCHAR(64) NOT NULL,
  page_type VARCHAR(20) NOT NULL CHECK (page_type IN ('homepage', 'contact', 'about', 'company', 'footer')),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(crawl_job_id, url)
);

CREATE INDEX IF NOT EXISTS idx_crawl_results_job_id ON crawl_results(crawl_job_id);
CREATE INDEX IF NOT EXISTS idx_crawl_results_hash ON crawl_results(html_hash);
