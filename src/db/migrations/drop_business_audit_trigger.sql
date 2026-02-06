-- Drop the audit trigger that references non-existent business_insert_audit table
-- This trigger is causing business inserts to fail with error: relation "public.business_insert_audit" does not exist

-- First, drop the trigger (must be dropped before the function)
DROP TRIGGER IF EXISTS audit_business_insert_trigger ON businesses;
DROP TRIGGER IF EXISTS trg_audit_business_insert ON businesses;

-- Then drop the function (after trigger is removed)
DROP FUNCTION IF EXISTS audit_business_insert() CASCADE;
