-- Create credit_transactions table for credit-based billing
-- Tracks all credit additions and consumptions

CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, -- Positive = added, negative = consumed
  reason TEXT NOT NULL, -- Description of transaction (e.g., "Monthly subscription", "Discovery run", "Export")
  reference_id UUID, -- Optional link to discovery_run, export, dataset, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_reference_id ON credit_transactions(reference_id) WHERE reference_id IS NOT NULL;

-- Comments
COMMENT ON TABLE credit_transactions IS 'Tracks all credit additions and consumptions for billing';
COMMENT ON COLUMN credit_transactions.amount IS 'Positive = credits added, negative = credits consumed';
COMMENT ON COLUMN credit_transactions.reason IS 'Human-readable description of the transaction';
COMMENT ON COLUMN credit_transactions.reference_id IS 'Optional link to discovery_run, export, dataset, etc.';
