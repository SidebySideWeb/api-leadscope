-- Create exports table to track all data exports
-- This table logs who exported what, when, and how much

CREATE TABLE IF NOT EXISTS exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  export_type VARCHAR(20) NOT NULL CHECK (export_type IN ('snapshot', 'subscription', 'admin')),
  industry_id INTEGER REFERENCES industries(id),
  city_id INTEGER REFERENCES cities(id),
  total_rows INTEGER NOT NULL,
  file_format VARCHAR(10) NOT NULL CHECK (file_format IN ('csv', 'xlsx')),
  file_path TEXT NOT NULL,
  watermark_text TEXT NOT NULL,
  filters JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_exports_user_id ON exports(user_id);
CREATE INDEX IF NOT EXISTS idx_exports_type ON exports(export_type);
CREATE INDEX IF NOT EXISTS idx_exports_created_at ON exports(created_at);
CREATE INDEX IF NOT EXISTS idx_exports_industry_city ON exports(industry_id, city_id);

-- Index for subscription export tracking
CREATE INDEX IF NOT EXISTS idx_exports_user_type_created ON exports(user_id, export_type, created_at) 
  WHERE export_type = 'subscription';
