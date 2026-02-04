# RLS Configuration for Backend

## Current Issue

Your backend uses direct PostgreSQL connection (`pg.Pool`) but Supabase tables have RLS enabled. RLS policies use `auth.uid()` which only works with Supabase client connections that have JWT tokens.

When using direct PostgreSQL connection:
- `auth.uid()` returns `NULL`
- RLS policies block all queries
- Backend cannot read/write data

## Solution Options

### Option 1: Use Postgres Superuser (Recommended)

**If your `DATABASE_URL` uses the `postgres` superuser, it bypasses RLS automatically.**

Check your connection string:
```bash
# Should look like:
# postgresql://postgres.qumptzqcuyswyvuwdegw:password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
```

The `postgres.qumptzqcuyswyvuwdegw` user is the superuser and bypasses RLS.

**Verify:**
```sql
-- Run in Supabase SQL Editor
SELECT current_user;
-- Should return: postgres
```

If it's `postgres`, RLS is already bypassed. No changes needed!

### Option 2: Create Service Role for Backend

If you need a dedicated role for backend:

```sql
-- Create role that bypasses RLS
CREATE ROLE backend_service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO backend_service_role;
ALTER ROLE backend_service_role BYPASSRLS;

-- Create user for backend
CREATE USER backend_user WITH PASSWORD 'your-secure-password';
GRANT backend_service_role TO backend_user;
```

Then update `DATABASE_URL` to use `backend_user`.

### Option 3: Disable RLS (Not Recommended)

**Only if you handle security in application layer:**

```sql
ALTER TABLE datasets DISABLE ROW LEVEL SECURITY;
ALTER TABLE businesses DISABLE ROW LEVEL SECURITY;
ALTER TABLE exports DISABLE ROW LEVEL SECURITY;
-- ... etc
```

**⚠️ Security Risk:** This removes multi-tenancy protection. Only do this if your backend properly filters by `user_id` in all queries.

## Recommended Approach

**Keep RLS enabled** and ensure your `DATABASE_URL` uses the `postgres` superuser. This:
- ✅ Bypasses RLS for backend operations
- ✅ Keeps RLS protection for direct Supabase client queries
- ✅ Maintains multi-tenancy security
- ✅ No code changes needed

## Verification

Test if RLS is bypassed:

```sql
-- In Supabase SQL Editor, run as postgres user
SELECT COUNT(*) FROM datasets;
-- Should return all datasets (not filtered by user)
```

If you see all datasets, RLS is bypassed correctly.

## Current Status

Based on your `.env` file, you're using:
```
DATABASE_URL=postgresql://postgres.qumptzqcuyswyvuwdegw:...
```

The `postgres.qumptzqcuyswyvuwdegw` user is the superuser, so **RLS should already be bypassed**.

If datasets still aren't showing, the issue is likely:
1. Backend not running
2. Authentication not working (user ID not being passed)
3. No datasets exist for the user
4. Frontend can't connect to backend

Check backend logs for the debugging output we added.
