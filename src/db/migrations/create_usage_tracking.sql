/**
 * Usage Tracking Table
 * 
 * Tracks monthly usage per user for:
 * - exports_this_month
 * - crawls_this_month
 * - datasets_created_this_month
 * 
 * Resets automatically at the start of each month.
 */

CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  month_year VARCHAR(7) NOT NULL, -- Format: 'YYYY-MM' (e.g., '2025-01')
  exports_this_month INTEGER NOT NULL DEFAULT 0,
  crawls_this_month INTEGER NOT NULL DEFAULT 0,
  datasets_created_this_month INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- One record per user per month
  UNIQUE (user_id, month_year)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_month ON usage_tracking(user_id, month_year);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_month_year ON usage_tracking(month_year);

-- Function to get current month-year string
CREATE OR REPLACE FUNCTION get_current_month_year() RETURNS VARCHAR(7) AS $$
  SELECT TO_CHAR(NOW(), 'YYYY-MM');
$$ LANGUAGE SQL IMMUTABLE;

-- Function to reset usage for a new month (called automatically)
CREATE OR REPLACE FUNCTION ensure_usage_record(user_uuid UUID) RETURNS UUID AS $$
DECLARE
  current_month VARCHAR(7);
  usage_id UUID;
BEGIN
  current_month := get_current_month_year();
  
  -- Try to get existing record
  SELECT id INTO usage_id
  FROM usage_tracking
  WHERE user_id = user_uuid AND month_year = current_month;
  
  -- If no record exists, create one
  IF usage_id IS NULL THEN
    INSERT INTO usage_tracking (user_id, month_year)
    VALUES (user_uuid, current_month)
    RETURNING id INTO usage_id;
  END IF;
  
  RETURN usage_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE usage_tracking IS 'Tracks monthly usage per user for exports, crawls, and datasets';
COMMENT ON COLUMN usage_tracking.month_year IS 'Format: YYYY-MM, used to automatically reset monthly';
