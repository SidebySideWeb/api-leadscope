# `/datasets` API Endpoint - Complete Documentation & Debugging Guide

## Endpoint Overview

**Route:** `GET /api/datasets`  
**Authentication:** Required (JWT token in cookie)  
**Middleware:** `authMiddleware`  
**File:** `src/api/datasets.ts` (lines 16-281)

## Request Format

### Headers
```
Cookie: token=<JWT_TOKEN>
```

### Query Parameters
None

### Example Request
```bash
curl -X GET http://localhost:3001/api/datasets \
  -H "Cookie: token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## Response Format

### Success (200 OK)
```json
{
  "data": [
    {
      "id": "dataset-uuid",
      "name": "My Dataset",
      "industry": "Technology",
      "city": "Athens",
      "businesses": 150,
      "contacts": 450,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "refreshStatus": "snapshot" | "refreshing" | "outdated",
      "lastRefresh": "2024-01-15T10:30:00.000Z" | null
    }
  ],
  "meta": {
    "plan_id": "professional" | "demo" | "starter",
    "gated": false,
    "total_available": 5,
    "total_returned": 5
  }
}
```

### Error (500 Internal Server Error)
```json
{
  "data": null,
  "meta": {
    "plan_id": "demo",
    "gated": false,
    "total_available": 0,
    "total_returned": 0,
    "gate_reason": "Failed to fetch datasets" | "<detailed error in dev>"
  }
}
```

## Execution Flow

### Step 1: Authentication (authMiddleware)
```typescript
// Extracts JWT from cookie
const token = getTokenFromCookie(req.cookies);
// Verifies token
const payload = verifyToken(token);
// Gets user from database
const user = await getUserById(payload.id);
// Attaches to request
req.userId = user.id;
```

**Potential Failures:**
- ❌ No token in cookie → 401 Unauthorized
- ❌ Invalid token → 401 Unauthorized
- ❌ User not found → 401 Unauthorized

### Step 2: Validate User ID
```typescript
if (!userId || typeof userId !== 'string' || userId.trim() === '') {
  return 401 with "Invalid user ID"
}
```

**Potential Failures:**
- ❌ userId is null/undefined
- ❌ userId is not a string
- ❌ userId is empty string

### Step 3: Check Contacts Table Exists
```typescript
const tableCheck = await pool.query(`
  SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'contacts'
  )
`);
```

**Potential Failures:**
- ⚠️ Query fails (logged as warning, continues anyway)

### Step 4: Execute Main Query
```sql
SELECT 
  d.id,
  d.user_id,
  d.name,
  d.city_id::text as city_id,
  d.industry_id::text as industry_id,
  d.last_refreshed_at,
  d.created_at,
  COUNT(DISTINCT b.id) as businesses_count,
  COUNT(DISTINCT c.id) as contacts_count  -- or 0 if contacts table doesn't exist
FROM datasets d
LEFT JOIN businesses b ON b.dataset_id = d.id
LEFT JOIN contacts c ON c.business_id = b.id  -- Only if contacts table exists
WHERE d.user_id = $1
GROUP BY d.id, d.user_id, d.name, d.city_id, d.industry_id, d.last_refreshed_at, d.created_at
ORDER BY d.created_at DESC
```

**Potential Failures:**
- ❌ `datasets` table doesn't exist → PostgreSQL error
- ❌ `businesses` table doesn't exist → PostgreSQL error
- ❌ `contacts` table doesn't exist (if contactsTableExists=true) → PostgreSQL error
- ❌ Column type mismatch (city_id, industry_id) → PostgreSQL error
- ❌ Missing GROUP BY columns → PostgreSQL error: "column must appear in GROUP BY"
- ❌ Invalid user_id format → Query returns 0 rows (not an error, but no data)

### Step 5: Fetch Industries & Cities
```typescript
const [industries, cities] = await Promise.all([
  getIndustries(),  // SELECT * FROM industries ORDER BY name ASC
  getCities(),      // SELECT * FROM cities ORDER BY name ASC
]);
```

**Potential Failures:**
- ❌ `industries` table doesn't exist → Error logged, continues with empty array
- ❌ `cities` table doesn't exist → Error logged, continues with empty array
- ⚠️ If fails, datasets will show "Unknown" for industry/city

### Step 6: Map Results
```typescript
const datasets = result.rows.map(row => {
  // Maps database row to frontend format
  // Handles industry/city name lookup
  // Calculates refresh status
});
```

**Potential Failures:**
- ❌ Date parsing error → JavaScript error
- ❌ Type conversion error → JavaScript error

### Step 7: Fetch User Plan
```typescript
const userResult = await pool.query(
  'SELECT plan FROM users WHERE id = $1',
  [userId]
);
const userPlan = userResult.rows[0]?.plan || 'demo';
```

**Potential Failures:**
- ❌ `users` table doesn't exist → Error logged, defaults to 'demo'
- ❌ User not found → Defaults to 'demo'
- ⚠️ If fails, plan_id will be 'demo' (not an error, just default)

### Step 8: Return Response
```typescript
res.json({ data: datasets, meta: {...} });
```

## Dependencies

### Database Tables (Required)
1. ✅ `datasets` - Must exist
2. ✅ `businesses` - Must exist (for LEFT JOIN)
3. ⚠️ `contacts` - Optional (checked dynamically)
4. ⚠️ `industries` - Optional (for name mapping)
5. ⚠️ `cities` - Optional (for name mapping)
6. ⚠️ `users` - Optional (for plan lookup)

### Database Functions
- `getIndustries()` - `src/db/industries.ts`
- `getCities()` - `src/db/cities.ts`
- `getUserById()` - `src/db/users.ts` (via authMiddleware)

### Middleware
- `authMiddleware` - `src/middleware/auth.ts`

## Common Error Scenarios

### 1. "column must appear in GROUP BY"
**Error:** PostgreSQL error code `42803`  
**Cause:** Missing column in GROUP BY clause  
**Fix:** Ensure all non-aggregated columns are in GROUP BY

### 2. "relation 'datasets' does not exist"
**Error:** PostgreSQL error code `42P01`  
**Cause:** Table doesn't exist or wrong schema  
**Fix:** Check table exists: `SELECT * FROM datasets LIMIT 1;`

### 3. "invalid input syntax for type uuid"
**Error:** PostgreSQL error code `22P02`  
**Cause:** user_id format mismatch (expecting UUID, got string)  
**Fix:** Check user_id format matches database column type

### 4. "permission denied for table datasets"
**Error:** PostgreSQL error code `42501`  
**Cause:** Database user doesn't have SELECT permission  
**Fix:** Even with RLS disabled, check user permissions

### 5. "syntax error at or near"
**Error:** PostgreSQL error code `42601`  
**Cause:** SQL syntax error  
**Fix:** Check query syntax, especially CAST operations (`::text`)

## Debugging Steps

### Step 1: Check Backend Logs
Look for these log messages in order:

```
[datasets] Fetching datasets for user: <user-id>
[datasets] User ID type: string
[datasets] User ID length: <length>
[datasets] Executing query with userId: <user-id>
[datasets] Contacts table exists: true/false
[datasets] Query returned X rows
[datasets] Loaded X industries and X cities
[datasets] User plan: professional
[datasets] Found X datasets for user <user-id>
```

**If logs stop at a certain point, that's where the error occurs.**

### Step 2: Test Database Connection
```bash
# SSH to server
ssh deploy@your-server

# Connect to database
psql $DATABASE_URL

# Test query
SELECT COUNT(*) FROM datasets;
SELECT COUNT(*) FROM businesses;
SELECT COUNT(*) FROM contacts;
SELECT COUNT(*) FROM industries;
SELECT COUNT(*) FROM cities;
SELECT COUNT(*) FROM users;
```

### Step 3: Test Query Directly
```sql
-- Replace 'your-user-id' with actual user ID from logs
SELECT 
  d.id,
  d.user_id,
  d.name,
  d.city_id::text as city_id,
  d.industry_id::text as industry_id,
  d.last_refreshed_at,
  d.created_at,
  COUNT(DISTINCT b.id) as businesses_count,
  COUNT(DISTINCT c.id) as contacts_count
FROM datasets d
LEFT JOIN businesses b ON b.dataset_id = d.id
LEFT JOIN contacts c ON c.business_id = b.id
WHERE d.user_id = 'your-user-id'
GROUP BY d.id, d.user_id, d.name, d.city_id, d.industry_id, d.last_refreshed_at, d.created_at
ORDER BY d.created_at DESC;
```

**If this query fails, you'll see the exact PostgreSQL error.**

### Step 4: Check Table Schemas
```sql
-- Check datasets table structure
\d datasets

-- Check column types
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'datasets';

-- Check if user_id matches expected format
SELECT user_id, typeof(user_id) FROM datasets LIMIT 5;
```

### Step 5: Verify User ID Format
```sql
-- Check user IDs in datasets table
SELECT DISTINCT user_id FROM datasets LIMIT 10;

-- Check if your user ID exists
SELECT id FROM users WHERE id = 'your-user-id-from-logs';
```

### Step 6: Test Individual Components
```typescript
// Test industries query
SELECT * FROM industries ORDER BY name ASC LIMIT 5;

// Test cities query
SELECT * FROM cities ORDER BY name ASC LIMIT 5;

// Test user plan query
SELECT plan FROM users WHERE id = 'your-user-id';
```

## Quick Fix Checklist

- [ ] Backend is running (`pm2 list` or `systemctl status`)
- [ ] Database connection works (`/health` endpoint)
- [ ] JWT token is valid (check cookie in browser)
- [ ] User ID is extracted correctly (check logs)
- [ ] `datasets` table exists
- [ ] `businesses` table exists
- [ ] `contacts` table exists (or query uses simplified version)
- [ ] `industries` table exists (or error is handled)
- [ ] `cities` table exists (or error is handled)
- [ ] `users` table exists (or error is handled)
- [ ] User ID format matches database column type
- [ ] All columns in SELECT are in GROUP BY
- [ ] RLS is disabled OR using postgres superuser

## What to Share for Help

If still getting 500 error, share:

1. **Backend logs** (last 50 lines):
   ```bash
   pm2 logs leadscop-backend --lines 50
   ```

2. **Error response** from API:
   ```json
   {
     "data": null,
     "meta": {
       "gate_reason": "..."
     }
   }
   ```

3. **Database query test** (run the query from Step 3 above)

4. **Table existence check**:
   ```sql
   SELECT tablename FROM pg_tables WHERE schemaname = 'public';
   ```

5. **User ID from logs** (the one that appears in `[datasets] Fetching datasets for user:`)
