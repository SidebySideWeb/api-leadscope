-- Create users table for authentication
-- Stores user credentials and basic info

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL, -- bcrypt hash
  plan VARCHAR(20) NOT NULL DEFAULT 'demo' CHECK (plan IN ('demo', 'starter', 'pro')),
  is_internal_user BOOLEAN NOT NULL DEFAULT false, -- Super admin flag
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_internal ON users(is_internal_user) WHERE is_internal_user = true;

-- Add comments
COMMENT ON TABLE users IS 'User accounts with authentication credentials';
COMMENT ON COLUMN users.password_hash IS 'bcrypt hashed password';
COMMENT ON COLUMN users.is_internal_user IS 'If true, user is super admin with unlimited access';
