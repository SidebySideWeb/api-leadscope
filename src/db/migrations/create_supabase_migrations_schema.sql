-- Create supabase_migrations schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS supabase_migrations;

-- Create schema_migrations table for Supabase migration tracking
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  inserted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comment
COMMENT ON SCHEMA supabase_migrations IS 'Supabase migration tracking schema';
COMMENT ON TABLE supabase_migrations.schema_migrations IS 'Tracks applied Supabase migrations';
