# How to Run SQL Migrations in Supabase

## Step-by-Step Guide

### Step 1: Open Supabase Dashboard
1. Go to https://supabase.com/dashboard
2. Sign in to your account
3. Select your project (the one with your database)

### Step 2: Open SQL Editor
1. In the left sidebar, click on **"SQL Editor"**
2. Click **"New query"** button (top right)

### Step 3: Run First Migration - Add Unique Constraint

Copy and paste this SQL:

```sql
-- Clean up any duplicate business_ids first
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT business_id, COUNT(*) as cnt
    FROM extraction_jobs
    GROUP BY business_id
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_count > 0 THEN
    RAISE NOTICE 'Found % duplicate business_ids. Cleaning up...', duplicate_count;
    
    -- Keep the oldest extraction job for each business_id
    DELETE FROM extraction_jobs ej
    WHERE ej.id NOT IN (
      SELECT MIN(id)
      FROM extraction_jobs
      GROUP BY business_id
    );
  END IF;
END $$;

-- Add unique constraint
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_extraction_jobs_business_id'
  ) THEN
    ALTER TABLE extraction_jobs DROP CONSTRAINT unique_extraction_jobs_business_id;
  END IF;
END $$;

ALTER TABLE extraction_jobs
ADD CONSTRAINT unique_extraction_jobs_business_id 
UNIQUE (business_id);

-- Verify constraint was created
SELECT 
  constraint_name,
  constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'extraction_jobs'
  AND constraint_name = 'unique_extraction_jobs_business_id';
```

4. Click **"Run"** button (or press `Ctrl+Enter`)
5. Wait for success message: "Success. No rows returned"

### Step 4: Run Second Migration - Add business_id to contact_sources

In a **new query** (click "New query" again), copy and paste:

```sql
-- Add business_id column (UUID to match businesses.id)
ALTER TABLE contact_sources 
ADD COLUMN IF NOT EXISTS business_id UUID;

-- Add foreign key constraint
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'fk_contact_sources_business_id'
  ) THEN
    ALTER TABLE contact_sources DROP CONSTRAINT fk_contact_sources_business_id;
  END IF;
END $$;

ALTER TABLE contact_sources
ADD CONSTRAINT fk_contact_sources_business_id 
FOREIGN KEY (business_id) 
REFERENCES businesses(id) 
ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_contact_sources_business_id 
ON contact_sources(business_id);

-- Backfill existing data by matching through websites
UPDATE contact_sources cs
SET business_id = w.business_id::UUID
FROM websites w
WHERE cs.business_id IS NULL
  AND w.business_id IS NOT NULL
  AND (
    cs.source_url LIKE '%' || REPLACE(REPLACE(w.url, 'https://', ''), 'http://', '') || '%'
    OR cs.source_url = w.url
    OR cs.source_url LIKE w.url || '%'
    OR REPLACE(REPLACE(cs.source_url, 'https://', ''), 'http://', '') = REPLACE(REPLACE(w.url, 'https://', ''), 'http://', '')
  );

-- Show summary
SELECT 
  COUNT(*) as total_contact_sources,
  COUNT(business_id) as with_business_id,
  COUNT(*) - COUNT(business_id) as without_business_id,
  ROUND(100.0 * COUNT(business_id) / COUNT(*), 2) as percentage_populated
FROM contact_sources;
```

4. Click **"Run"** button
5. You should see a summary table showing how many contact_sources were updated

## Visual Guide

```
Supabase Dashboard
├── SQL Editor (left sidebar)
    ├── New query (button)
    ├── Paste SQL code
    ├── Click "Run" (or Ctrl+Enter)
    └── See results
```

## Verification

After running both migrations, verify they worked:

```sql
-- Check extraction_jobs constraint
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'extraction_jobs'
  AND constraint_name = 'unique_extraction_jobs_business_id';

-- Check contact_sources column
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'contact_sources'
  AND column_name = 'business_id';
```

Both should return results showing the constraint/column exists.

## Troubleshooting

### Error: "relation does not exist"
- Make sure you're connected to the correct database/project
- Check that the table name is correct (case-sensitive)

### Error: "permission denied"
- You need admin/owner permissions on the Supabase project
- Check your user role in Supabase

### Error: "constraint already exists"
- The migration handles this automatically
- It will drop and recreate the constraint

### Error: "column already exists"
- The migration uses `IF NOT EXISTS` so this shouldn't happen
- If it does, the column already exists and you can skip that part

## After Running Migrations

1. **Restart your backend:**
   ```bash
   pm2 restart leadscop-backend
   ```

2. **Test discovery:**
   - Run a discovery request
   - Check that extraction jobs are created
   - Verify businesses get contact details

3. **Check logs:**
   ```bash
   pm2 logs leadscop-backend --lines 100
   ```

## Files Location

The SQL files are located at:
- `leads-generation-backend/supabase/add_unique_constraint_extraction_jobs.sql`
- `leads-generation-backend/supabase/add_business_id_to_contact_sources.sql`

You can also copy the SQL directly from those files if needed.
