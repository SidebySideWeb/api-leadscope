# What's Broken - Comparison to 29/01 Successful Runs

## What Worked on 29/01
- ✅ Manual discovery runs were successful
- ✅ Exports were created at: `C:\Users\dgero\Documents\leads-generation\data\exports\...`
- ✅ Businesses, websites, contacts were being extracted

## What Changed Since Then

### 1. **Discovery Endpoint Changed to Async** ⚠️
**Before:** Discovery endpoint waited for extraction to complete and returned businesses with contact details
**Now:** Discovery endpoint returns immediately with just `discovery_run` info

**Impact:** Frontend might be expecting businesses but getting empty results

**Fix:** Frontend needs to poll `/businesses?datasetId=...` endpoint after discovery starts

### 2. **Extraction Jobs May Not Be Created** ⚠️
**Issue:** `ON CONFLICT (business_id) DO NOTHING` requires unique constraint on `business_id`

**Error:** `there is no unique or exclusion constraint matching the ON CONFLICT specification`

**Fix:** Run the SQL migration to add unique constraint:
```sql
-- See: supabase/add_unique_constraint_extraction_jobs.sql
```

### 3. **Contact Sources Business Linking** ⚠️
**Issue:** `contact_sources.business_id` column was added but queries might fail if:
- Column doesn't exist (migration not run)
- Type mismatch (UUID vs INTEGER)
- Data not backfilled

**Fix:** 
- Run migration: `supabase/add_business_id_to_contact_sources.sql`
- Ensure `business_id` is UUID type (not INTEGER)

### 4. **Extraction Worker May Not Be Running** ⚠️
**Issue:** Extraction jobs might be stuck in 'pending' if worker isn't processing them

**Check:**
```bash
# On server
pm2 logs leadscop-backend | grep "Extraction Worker"
# Should see: "Processing X extraction job(s)..."
```

### 5. **Database Connection Issues** ⚠️
**Issue:** Backend might not be connecting to database properly

**Check:**
- Database connection string
- RLS policies blocking inserts
- Missing tables/columns

## Diagnostic Steps

### Step 1: Run Diagnostic Script
```bash
cd ~/apps/leadscop-backend
node diagnose-current-issues.js
```

This will show:
- How many businesses exist
- How many extraction jobs exist
- How many are pending/failed
- How many websites/contacts were created
- Recent errors

### Step 2: Check Backend Logs
```bash
pm2 logs leadscop-backend --lines 200
```

Look for:
- `[discoverBusinesses] Enqueuing extraction_jobs...`
- `[Extraction Worker] Processing X extraction job(s)...`
- `[processExtractionJob] Creating contact...`
- `[createContact] RLS POLICY VIOLATION`
- `[createWebsite] DATABASE ERROR`

### Step 3: Check Database Constraints
```sql
-- Check if unique constraint exists on extraction_jobs.business_id
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'extraction_jobs'
  AND constraint_name LIKE '%business_id%';

-- Check if business_id column exists in contact_sources
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'contact_sources'
  AND column_name = 'business_id';
```

### Step 4: Verify Extraction Worker is Running
```bash
# Check if backend is running
pm2 status

# Check extraction worker logs
pm2 logs leadscop-backend | grep -i extraction
```

## Most Likely Issues (In Order)

1. **Missing Unique Constraint on extraction_jobs.business_id**
   - Extraction jobs can't be created
   - Fix: Run `supabase/add_unique_constraint_extraction_jobs.sql`

2. **Extraction Worker Not Processing Jobs**
   - Jobs stuck in 'pending'
   - Fix: Check if worker is running, check logs for errors

3. **Contact Sources Business ID Missing**
   - Contacts can't be linked to businesses
   - Fix: Run `supabase/add_business_id_to_contact_sources.sql`

4. **RLS Policies Blocking Inserts**
   - Websites/contacts can't be created
   - Fix: Check RLS policies, verify user permissions

5. **Discovery Endpoint Changed Behavior**
   - Frontend expecting businesses but getting discovery_run
   - Fix: Update frontend to poll `/businesses` endpoint

## Quick Fixes

### Fix 1: Add Missing Constraints
Run these SQL scripts in Supabase:
1. `supabase/add_unique_constraint_extraction_jobs.sql`
2. `supabase/add_business_id_to_contact_sources.sql`

### Fix 2: Restart Backend
```bash
pm2 restart leadscop-backend
# Or
systemctl restart leadscop-backend
```

### Fix 3: Manually Trigger Extraction
```bash
# If extraction jobs exist but aren't processing
# The worker should pick them up automatically
# But you can check logs to see if it's working
```

## Expected Flow (What Should Happen)

1. **Frontend calls** `POST /discovery/businesses`
2. **Backend creates** `discovery_run` (status: 'running')
3. **Backend starts** discovery job asynchronously
4. **Discovery worker** finds businesses, inserts them
5. **Discovery worker** creates `extraction_jobs` for each business
6. **Discovery worker** marks `discovery_run` as 'completed'
7. **Extraction worker** (runs every 10 seconds) picks up pending jobs
8. **Extraction worker** extracts websites, contacts, social media
9. **Extraction worker** marks `extraction_job` as 'success'
10. **Frontend polls** `/businesses?datasetId=...` to get results

## Next Steps

1. Run `diagnose-current-issues.js` to identify specific problems
2. Check backend logs for errors
3. Run missing SQL migrations
4. Verify extraction worker is running
5. Test discovery flow end-to-end
