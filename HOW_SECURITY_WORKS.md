# How Security Works: RLS Bypass + Application-Level Filtering

## The Two Layers of Security

### Layer 1: Database Connection (RLS Bypass)
- **What**: Backend connects to PostgreSQL using `postgres` superuser (via `DATABASE_URL`)
- **Why**: Allows backend to execute queries without RLS blocking them
- **How**: The `DATABASE_URL` in `.env` contains connection credentials:
  ```
  DATABASE_URL=postgresql://postgres.xxxxx:password@db.xxxxx.supabase.co:5432/postgres
  ```
- **Result**: Backend can read/write to all tables, bypassing RLS policies

### Layer 2: Application-Level Filtering (Your Security)
- **What**: Backend code filters all queries by `user_id` from JWT token
- **Why**: Ensures users only see their own data (multi-tenancy)
- **How**: Every query includes `WHERE user_id = $1` with the authenticated user's ID

## How It Works Together

### Step-by-Step Flow:

1. **User logs in** → JWT token created with `user.id` inside
2. **User makes request** → JWT token sent in cookie
3. **Auth middleware** (`src/middleware/auth.ts`):
   ```typescript
   // Extracts user ID from JWT token
   req.userId = payload.id;  // e.g., "abc-123-def-456"
   ```
4. **API route** (`src/api/datasets.ts`):
   ```typescript
   router.get('/', authMiddleware, async (req: AuthRequest, res) => {
     const userId = req.userId!;  // From JWT token
     
     // Query filters by user_id - THIS IS YOUR SECURITY!
     const result = await pool.query(`
       SELECT * FROM datasets
       WHERE user_id = $1  -- Only this user's datasets
     `, [userId]);
   });
   ```
5. **Database executes** → Returns only rows matching `user_id`

## Why This Approach?

### ✅ Benefits:
- **RLS doesn't block backend** → Backend can execute queries
- **Application enforces security** → Users only see their own data
- **Multi-tenancy maintained** → Each user's data is isolated
- **Flexible queries** → Backend can do complex joins without RLS interference

### 🔒 Security Guarantees:

1. **Authentication**: JWT token proves user identity
2. **Authorization**: Every query filters by `user_id` from token
3. **Data Isolation**: User A cannot see User B's data (even if RLS is bypassed)

## Example: Datasets Query

```typescript
// User "user-123" makes request
// Auth middleware extracts: req.userId = "user-123"

// Query executed:
SELECT * FROM datasets WHERE user_id = 'user-123'
// Returns: Only datasets owned by user-123

// Even though RLS is bypassed, the WHERE clause ensures:
// - User-123 sees only their datasets
// - User-456 cannot see user-123's datasets (different user_id in their token)
```

## Important Points:

1. **`DATABASE_URL` is still used** → It's how the backend connects to PostgreSQL
2. **Connection bypasses RLS** → Allows queries to execute
3. **Application code enforces security** → Filters by `user_id` in every query
4. **JWT token provides user identity** → Extracted by auth middleware
5. **Every query must filter by `user_id`** → This is your security layer

## What Happens If You Don't Filter by user_id?

⚠️ **Security Risk**: If a query doesn't filter by `user_id`, users could see all data!

Example of **BAD** query:
```typescript
// ❌ DANGEROUS - No user_id filter
const result = await pool.query('SELECT * FROM datasets');
// Returns ALL datasets from ALL users!
```

Example of **GOOD** query:
```typescript
// ✅ SECURE - Filters by user_id
const result = await pool.query(
  'SELECT * FROM datasets WHERE user_id = $1',
  [req.userId]
);
// Returns only current user's datasets
```

## Summary

- **RLS Bypass** = Database allows queries to execute
- **Application Filtering** = Your code ensures users only see their data
- **Both work together** = Backend can query database, but security is maintained

The `DATABASE_URL` is always used for the connection. RLS bypass just means PostgreSQL won't block the query - your application code still enforces security by filtering results.
