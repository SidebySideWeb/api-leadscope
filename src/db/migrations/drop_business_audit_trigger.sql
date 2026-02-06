-- Drop the audit trigger that references non-existent business_insert_audit table
-- This trigger is causing business inserts to fail with error: relation "public.business_insert_audit" does not exist

-- Drop the trigger if it exists
DROP TRIGGER IF EXISTS audit_business_insert_trigger ON businesses;

-- Drop the function if it exists (optional - only if we want to completely remove audit functionality)
-- DROP FUNCTION IF EXISTS audit_business_insert();
