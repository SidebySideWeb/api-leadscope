# Supabase Connection & RLS Bypass Guide

## Current Configuration

Your `.env` file uses:
```
DATABASE_URL=postgresql://postgres.qumptzqcuyswyvuwdegw:...@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
```

This is using Supabase's **connection pooler** (`pooler.supabase.com`).

## The Issue

Supabase connection poolers may still apply RLS even for the `postgres` superuser. This can cause:
- 500 errors when querying tables with RLS enabled
- Queries returning 0 rows even though data exists
- Backend unable to access data despite using superuser credentials

## Solution: Use Direct Connection

Supabase provides two connection string formats:

### 1. Connection Pooler (Current - May Have RLS Issues)
```
postgresql://postgres.xxxxx:password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
```
- Port: `5432` (Session mode) or `6543` (Transaction mode)
- Host: `*.pooler.supabase.com`
- **Issue**: May still apply RLS policies

### 2. Direct Connection (Recommended for Backend)
```
postgresql://postgres.xxxxx:password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?pgbouncer=true
```
OR better yet, use the direct connection hostname:
```
postgresql://postgres.xxxxx:password@db.xxxxx.supabase.co:5432/postgres
```
- Port: `5432`
- Host: `db.xxxxx.supabase.co` (direct connection, not pooler)
- **Benefit**: Fully bypasses RLS for superuser

## How to Get Direct Connection String

1. Go to Supabase Dashboard → Project Settings → Database
2. Look for **"Connection string"** section
3. Select **"Direct connection"** (not "Connection pooling")
4. Copy the connection string
5. It should look like: `postgresql://postgres.xxxxx:password@db.xxxxx.supabase.co:5432/postgres`

## Verify RLS Bypass

After updating `DATABASE_URL`, test the connection:

```bash
# Call the health endpoint
curl http://localhost:3001/health
```

Check the logs for:
```
[DATABASE] ✅ RLS is being bypassed (superuser access confirmed)
```

If you see:
```
[DATABASE] ⚠️ RLS Bypass Test FAILED
```

Then RLS is still being applied and you need to use the direct connection string.

## Alternative: Check Current User

You can also verify in Supabase SQL Editor:

```sql
-- Check current user
SELECT current_user;

-- Should return: postgres (or postgres.xxxxx)
-- If it returns something else, RLS might not be bypassed

-- Test RLS bypass
SELECT COUNT(*) FROM datasets;
-- Should return total count (not filtered by user_id)
```

## Important Notes

1. **Don't remove RLS** - It's a security feature. Use direct connection instead.
2. **Direct connection** has connection limits (typically 60-100 connections)
3. **Pooler** is better for serverless/high-concurrency, but may have RLS issues
4. **Backend servers** should use direct connection to bypass RLS
5. **Frontend/client** should use Supabase client SDK (which handles RLS correctly)

## Next Steps

1. Update `.env` with direct connection string from Supabase Dashboard
2. Restart backend server
3. Check `/health` endpoint logs
4. Test `/datasets` endpoint
5. If still failing, check backend logs for detailed error messages
