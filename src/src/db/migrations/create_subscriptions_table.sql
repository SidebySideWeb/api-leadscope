-- Create subscriptions table for Stripe subscription management
-- Webhook is the only plan authority - never trust client input

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  stripe_customer_id VARCHAR(255) NOT NULL,
  stripe_subscription_id VARCHAR(255) NOT NULL UNIQUE,
  plan VARCHAR(20) NOT NULL CHECK (plan IN ('demo', 'starter', 'pro')),
  status VARCHAR(50) NOT NULL, -- Stripe subscription status (active, canceled, past_due, etc.)
  stripe_price_id VARCHAR(255), -- Stripe price ID for mapping
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure one active subscription per user
  UNIQUE(user_id, stripe_subscription_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan);

-- Add comment
COMMENT ON TABLE subscriptions IS 'Stripe subscription data. Webhook is the only plan authority.';
COMMENT ON COLUMN subscriptions.plan IS 'Internal plan enum: demo, starter, pro';
COMMENT ON COLUMN subscriptions.status IS 'Stripe subscription status (active, canceled, past_due, etc.)';
