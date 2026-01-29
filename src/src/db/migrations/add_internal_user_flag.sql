-- Add is_internal_user flag to subscriptions table
-- Internal users bypass all plan limits, export caps, and can re-crawl
-- This is server-side only and cannot be set by client

ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS is_internal_user BOOLEAN NOT NULL DEFAULT false;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_internal_user ON subscriptions(is_internal_user) 
  WHERE is_internal_user = true;

-- Add comment
COMMENT ON COLUMN subscriptions.is_internal_user IS 'If true, user bypasses all plan limits, export caps, and can re-crawl. Server-side only.';
