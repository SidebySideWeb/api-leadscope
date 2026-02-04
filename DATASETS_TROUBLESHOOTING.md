# Troubleshooting: No Datasets Showing in Frontend

## Issues Fixed

1. **Error Response Format** - Backend now returns consistent `{ data, meta }` format even on errors
2. **Added Logging** - Backend logs user ID, query results, and dataset IDs for debugging
3. **Better Error Messages** - Error responses include proper meta structure

## Common Causes

### 1. Backend Not Running
**Check:**
```bash
curl http://localhost:3001/health
```

**Start backend:**
```bash
cd leads-generation-backend
PORT=3001 npm run dev
```

### 2. Frontend Can't Connect to Backend
**Check `.env.local` in frontend:**
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

**Restart frontend after creating/updating `.env.local`**

### 3. No Datasets in Database
**This is normal if:**
- You haven't run any discoveries yet
- You're logged in as a different user
- Datasets were created for a different user ID

**To create a dataset:**
1. Go to `/discover` page
2. Select an industry and city
3. Click "Discover Leads"
4. Wait for discovery to complete
5. Check `/datasets` page

### 4. Authentication Issues
**Check backend logs for:**
- `[datasets] Fetching datasets for user: <userId>`
- `[datasets] Query returned X rows`
- `[datasets] Found X datasets for user <userId>`

**If you see 401/403 errors:**
- Make sure you're logged in
- Check that JWT cookie is being sent
- Verify backend auth middleware is working

### 5. User ID Mismatch
**Check:**
- Are you logged in as the same user who created the datasets?
- Check database: `SELECT user_id, COUNT(*) FROM datasets GROUP BY user_id;`

## Debugging Steps

1. **Check Backend Logs:**
   Look for:
   ```
   [datasets] Fetching datasets for user: <userId>
   [datasets] Query returned X rows
   [datasets] Found X datasets for user <userId>
   [datasets] Dataset IDs: [...]
   ```

2. **Check Frontend Console:**
   Look for:
   ```
   [DatasetsPage] Fetching datasets from API...
   [DatasetsPage] API response: { hasData: true/false, dataLength: X }
   ```

3. **Check Network Tab:**
   - Request to `/api/datasets` or `/datasets`
   - Response status (200, 401, 403, 500)
   - Response body structure

4. **Test Backend Directly:**
   ```bash
   curl -H "Cookie: token=<your-jwt-token>" http://localhost:3001/datasets
   ```

## Expected Behavior

**When datasets exist:**
- Backend returns: `{ data: [...], meta: { ... } }`
- Frontend displays datasets in table
- No error messages

**When no datasets exist:**
- Backend returns: `{ data: [], meta: { total_available: 0, total_returned: 0 } }`
- Frontend shows "No datasets yet" message
- "Run First Discovery" button is visible

## Next Steps

1. Ensure backend is running on port 3001
2. Ensure frontend has `.env.local` with correct API URL
3. Check backend logs when accessing `/datasets` page
4. Run a discovery to create a dataset
5. Check if datasets appear after discovery completes
