# Where to Find Backend Logs

## Log Locations

### 1. **Console/Stdout Logs** (Most Common)
The backend logs to `stdout` and `stderr`. Where you see them depends on how you're running the backend:

#### If running directly:
```bash
npm start
# Logs appear in the terminal
```

#### If using PM2:
```bash
# View logs
pm2 logs leadscop-backend

# View last 100 lines
pm2 logs leadscop-backend --lines 100

# Follow logs in real-time
pm2 logs leadscop-backend --lines 0
```

#### If using systemd:
```bash
# View logs
journalctl -u leadscop-backend

# View last 100 lines
journalctl -u leadscop-backend -n 100

# Follow logs in real-time
journalctl -u leadscop-backend -f

# View logs from today
journalctl -u leadscop-backend --since today
```

#### If using Docker:
```bash
docker logs <container-name>
docker logs -f <container-name>  # follow
docker logs --tail 100 <container-name>
```

### 2. **Log Files** (If configured)
Check if logs are written to files:
```bash
# Common locations
/var/log/leadscop-backend/
~/apps/leadscop-backend/logs/
./logs/
```

### 3. **Production Server Logs**
On your production server (`deploy@leads-generate`):

```bash
# SSH into server
ssh deploy@leads-generate

# Check PM2 logs
pm2 logs leadscop-backend --lines 200

# Or check systemd
journalctl -u leadscop-backend -n 200
```

## What to Look For

### Extraction Worker Logs
Look for these log messages:
- `[Extraction Worker] Processing X extraction job(s)...`
- `[processExtractionJob] Extracting contact details...`
- `[processExtractionJob] Creating contact...`
- `[processExtractionJob] Creating website...`
- `[createContact] Attempting to create contact...`
- `[createWebsite] Attempting to create website...`
- `[createContactSource] Attempting to create contact_source...`

### Error Messages
Look for:
- `[Extraction Worker] Error processing batch:`
- `[processExtractionJob] CRITICAL ERROR`
- `[createContact] RLS POLICY VIOLATION`
- `[createWebsite] DATABASE ERROR`
- `[createContactSource] FOREIGN KEY VIOLATION`

## Diagnostic Commands

### Check if extraction jobs exist:
```bash
# Run the diagnostic script
node check-extraction-status.js
```

### Check extraction jobs in database:
```sql
SELECT 
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  COUNT(*) FILTER (WHERE status = 'running') as running,
  COUNT(*) FILTER (WHERE status = 'success') as success,
  COUNT(*) FILTER (WHERE status = 'failed') as failed
FROM extraction_jobs;
```

### Check if businesses have extraction jobs:
```sql
SELECT 
  COUNT(*) as businesses_without_jobs
FROM businesses b
LEFT JOIN extraction_jobs ej ON ej.business_id = b.id
WHERE ej.id IS NULL;
```

### Check recent failed extraction jobs:
```sql
SELECT 
  id, business_id, status, error_message, created_at
FROM extraction_jobs
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 10;
```

## Common Issues

### 1. Extraction Jobs Not Created
**Symptom:** Businesses exist but no extraction_jobs
**Check:** Look for logs from `discoveryWorker.ts`:
- `[discoverBusinesses] Enqueuing extraction jobs...`
- `[discoverBusinesses] Created X extraction jobs`

### 2. Extraction Worker Not Running
**Symptom:** Extraction jobs stuck in 'pending'
**Check:** 
- Is the backend running? `pm2 status` or `systemctl status leadscop-backend`
- Look for: `📦 Starting extraction worker`

### 3. Extraction Jobs Failing
**Symptom:** Extraction jobs in 'failed' status
**Check:** 
- Look at `error_message` column in `extraction_jobs` table
- Check logs for `[processExtractionJob] CRITICAL ERROR`

### 4. RLS Policy Blocking Inserts
**Symptom:** No websites/contacts created, RLS errors in logs
**Check:** 
- Look for: `[createContact] RLS POLICY VIOLATION`
- Verify RLS policies allow inserts for authenticated users

## Quick Diagnostic

Run this on your server:
```bash
cd ~/apps/leadscop-backend
node check-extraction-status.js
```

This will show you:
- How many extraction jobs exist
- How many are pending/running/success/failed
- How many businesses don't have extraction jobs
- Recent errors
