# Supabase Configuration

## Row Level Security (RLS)

RLS policies enforce multi-tenancy by ensuring users can only access their own data.

### Policy Files

- `supabase/rls.sql` - RLS policies for all protected tables

### Protected Tables

1. **datasets** - Users can only see their own datasets
2. **businesses** - Users can only see businesses in their datasets
3. **crawl_results** - Users can only see crawl results for their datasets
4. **exports** - Users can only see their own exports
5. **usage_tracking** - Users can only see their own usage
6. **subscriptions** - Users can only see their own subscriptions

### Applying RLS Policies

Run the RLS policies in your Supabase SQL editor or via migration:

```sql
-- Execute supabase/rls.sql in Supabase SQL Editor
-- Or via Supabase CLI:
-- supabase db push
```

## API Keys Usage

### Anon Key (Public)

**Used by:** Frontend (Next.js dashboard)

**Purpose:** 
- Client-side queries to Supabase
- Reads data with RLS policies enforcing multi-tenancy
- Cannot bypass RLS

**Environment Variable:**
```env
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Usage:**
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! // Anon key
)
```

### Service Role Key (Backend Only)

**Used by:** Backend API routes, workers, webhooks

**Purpose:**
- Server-side operations that need to bypass RLS
- Writing data (INSERT/UPDATE/DELETE)
- Admin operations
- Webhook handlers (Stripe, etc.)

**Environment Variable:**
```env
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**⚠️ SECURITY WARNING:** Never expose service role key to frontend or client-side code!

**Usage:**
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Service role key
)
```

## User ID Format Mapping

### Issue

Some tables use `VARCHAR(255)` for `user_id` while others use `UUID`:

- **VARCHAR(255)**: `datasets.user_id`, `subscriptions.user_id`, `exports.user_id`
- **UUID**: `usage_tracking.user_id`, `users.id`

### Solution

RLS policies handle this by:

1. **For VARCHAR(255) columns**: Compare with `auth.uid()::text`
   ```sql
   WHERE user_id = auth.uid()::text
   ```

2. **For UUID columns**: Compare directly with `auth.uid()`
   ```sql
   WHERE user_id = auth.uid()
   ```

### Backend Consistency

Ensure backend stores user IDs consistently:

- If using Supabase Auth: Store `auth.uid()::text` in VARCHAR(255) columns
- If using custom JWT: Extract `user_id` from JWT claims and store as string

## Testing RLS Policies

### Test as Authenticated User

```sql
-- Set auth context (in Supabase SQL Editor)
SET request.jwt.claim.sub = 'user-uuid-here';

-- Test SELECT
SELECT * FROM datasets; -- Should only return user's datasets
SELECT * FROM businesses; -- Should only return businesses in user's datasets
```

### Test as Service Role

```typescript
// Backend code using service role key bypasses RLS
const supabase = createClient(url, serviceRoleKey)
const { data } = await supabase.from('datasets').select('*') // Returns all datasets
```

## Troubleshooting

### "Permission denied" errors

- Check that user is authenticated (`auth.uid()` is not null)
- Verify `user_id` format matches policy (VARCHAR(255) vs UUID)
- Ensure backend uses service role key for writes

### Policies not applying

- Verify RLS is enabled: `ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;`
- Check policy exists: `SELECT * FROM pg_policies WHERE tablename = 'table_name';`
- Ensure using anon key (not service role) for frontend queries

### User ID mismatch

- Check if `user_id` in database matches `auth.uid()::text`
- Verify JWT contains correct user ID in claims
- Consider creating a mapping table if IDs differ
