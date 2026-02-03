# Where is My Data? - Understanding Extraction vs Exports

## Important Distinction

### Extraction Jobs ≠ Export Files

**Extraction Jobs:**
- ✅ Extract contact details (websites, emails, phones)
- ✅ Store data in database tables:
  - `websites` table
  - `contacts` table  
  - `contact_sources` table
- ❌ Do NOT create files
- Status: `success` means data was extracted and stored in database

**Export Files:**
- ✅ Create CSV/XLSX files
- ✅ Downloadable files
- ✅ Created separately via `/exports` endpoint
- ❌ Not automatically created by extraction jobs

## Your Extraction Job Status

Your extraction job shows:
```json
{
  "status": "success",
  "business_id": "fe11ed10-6555-45e1-bad5-491d7206e27b"
}
```

This means:
- ✅ Contact details were extracted
- ✅ Data is stored in database
- ❌ No file was created (extraction jobs don't create files)

## Where to Find the Extracted Data

### Option 1: Query Database Directly

```sql
-- Get business details
SELECT * FROM businesses WHERE id = 'fe11ed10-6555-45e1-bad5-491d7206e27b';

-- Get website for this business
SELECT * FROM websites WHERE business_id = 'fe11ed10-6555-45e1-bad5-491d7206e27b';

-- Get contacts for this business
SELECT 
  c.email,
  c.phone,
  c.mobile,
  cs.source_url,
  cs.page_type
FROM contacts c
JOIN contact_sources cs ON cs.contact_id = c.id
WHERE cs.business_id = 'fe11ed10-6555-45e1-bad5-491d7206e27b';
```

### Option 2: Use API Endpoints

**Get businesses with contacts:**
```
GET /businesses?datasetId=<your-dataset-id>
```

**Get specific business:**
```
GET /businesses/<business-id>
```

## How to Create Export Files (CSV/XLSX)

Export files are created separately. You need to:

### Step 1: Get Dataset ID
```sql
SELECT id, name FROM datasets WHERE user_id = '<your-user-id>';
```

### Step 2: Create Export via API
```bash
POST /exports/run
{
  "datasetId": "<your-dataset-id>",
  "format": "csv"  # or "xlsx"
}
```

### Step 3: Download Export File
```bash
GET /exports/<export-id>/download
```

Or use the frontend export feature.

## Where Export Files Are Stored

### Production (Supabase Storage)
- Files stored in Supabase Storage bucket: `exports`
- Path: `exports/<user-id>/<filename>`
- Access via signed URL (expires in 7-30 days)

### Local Development
- Files stored in: `data/exports/<user-id>/<filename>`
- Or: `.local-exports/<user-id>/<filename>`
- Path: `C:\Users\dgero\Documents\leads-generation\data\exports\...`

## Check What Was Extracted

Run this SQL to see what was extracted for your business:

```sql
-- Replace with your business_id
SELECT 
  b.id,
  b.name,
  b.address,
  w.url as website,
  c.email,
  COALESCE(c.phone, c.mobile) as phone,
  cs.source_url,
  cs.page_type
FROM businesses b
LEFT JOIN websites w ON w.business_id = b.id
LEFT JOIN contact_sources cs ON cs.business_id = b.id::text
LEFT JOIN contacts c ON c.id = cs.contact_id
WHERE b.id = 'fe11ed10-6555-45e1-bad5-491d7206e27b';
```

## Summary

1. **Extraction Job = Success** ✅
   - Means: Contact details extracted and stored in database
   - Location: Database tables (`websites`, `contacts`, `contact_sources`)
   - No file created

2. **Export File** 📄
   - Created separately via export endpoint
   - Location: Supabase Storage or local `data/exports/` directory
   - Downloadable CSV/XLSX file

3. **To Get Your Data:**
   - Query database directly (see SQL above)
   - Use `/businesses` API endpoint
   - Create export file via `/exports/run` endpoint
