-- Add phone and email columns directly to businesses table
-- This allows storing contact information directly on the business record

-- Add phone column if it doesn't exist
ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

-- Add email column if it doesn't exist
ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_businesses_phone ON businesses(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_email ON businesses(email) WHERE email IS NOT NULL;
