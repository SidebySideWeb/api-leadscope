# Backend Permission Resolver

Source of truth: Stripe subscription state (database)
Never trusts client payload

## Overview

The permission resolver provides a centralized way to get user permissions based on their Stripe subscription plan. It always queries the database to get the user's plan, never trusting client-provided information.

## Function: `getUserPermissions(userId)`

Returns user permissions based on their plan:

```typescript
interface UserPermissions {
  plan: 'demo' | 'starter' | 'pro';
  max_export_rows: number;
  max_crawl_pages: number; // Max crawl depth
  max_datasets: number;
  can_refresh: boolean;
}
```

## Plan Permissions

### Demo Plan
- `max_export_rows`: 50
- `max_crawl_pages`: 1 (depth 1 only)
- `max_datasets`: 1
- `can_refresh`: false (no refresh)

### Starter Plan
- `max_export_rows`: 1,000
- `max_crawl_pages`: 3 (depth 3)
- `max_datasets`: 5
- `can_refresh`: true (monthly refresh)

### Pro Plan
- `max_export_rows`: Unlimited (Number.MAX_SAFE_INTEGER)
- `max_crawl_pages`: 10 (depth 10)
- `max_datasets`: Unlimited (Number.MAX_SAFE_INTEGER)
- `can_refresh`: true (monthly refresh)

## Source of Truth

The permission resolver:
1. Queries the `subscriptions` table (populated by Stripe webhooks)
2. Gets the user's current plan from the database
3. Never trusts client-provided plan information
4. Falls back to 'demo' plan if database query fails

## Usage

### Basic Usage

```typescript
import { getUserPermissions } from '../db/permissions.js';

const permissions = await getUserPermissions(userId);

console.log(permissions.plan); // 'demo' | 'starter' | 'pro'
console.log(permissions.max_export_rows); // 50, 1000, or unlimited
console.log(permissions.max_crawl_pages); // 1, 3, or 10
console.log(permissions.can_refresh); // false or true
```

### Check Permission

```typescript
import { checkPermission } from '../db/permissions.js';

// Check if user can export a specific number of rows
const check = await checkPermission(userId, 'export', 100);

if (!check.allowed) {
  console.log(check.reason);
  console.log(check.upgrade_hint);
}

// Check if user can refresh datasets
const refreshCheck = await checkPermission(userId, 'refresh');

if (!refreshCheck.allowed) {
  console.log('Refresh not allowed for demo plan');
}
```

## Integration with Workers

### Export Worker

```typescript
// Get permissions from database (never trust client)
const permissions = await getUserPermissions(userId);
const userPlan = permissions.plan;

// Use max_export_rows from permissions
const maxRows = permissions.max_export_rows;
const isGated = rowsTotal > maxRows;
const rowsToExport = Math.min(rowsTotal, maxRows);
```

### Crawl Worker

```typescript
// Get permissions from database (never trust client)
const permissions = await getUserPermissions(userId);
const maxCrawlDepth = permissions.max_crawl_pages; // 1, 3, or 10

// Enforce depth limit during BFS crawl
if (depth > maxCrawlDepth) {
  continue; // Skip this URL
}
```

### Discovery Service

```typescript
// Get permissions from database (never trust client)
const permissions = await getUserPermissions(userId);

// Check if user can create more datasets
if (permissions.max_datasets !== Number.MAX_SAFE_INTEGER) {
  const datasetCount = await countUserDatasets(userId);
  if (datasetCount >= permissions.max_datasets) {
    // Limit reached
  }
}

// Check if user can refresh
if (!permissions.can_refresh) {
  // Demo plan - no refresh allowed
}
```

## Security

### Never Trust Client Payload

❌ **WRONG:**
```typescript
// DON'T: Trust client-provided plan
const result = await exportWorkerV1({
  datasetId,
  format,
  userPlan: req.body.userPlan, // NEVER DO THIS
  userId,
});
```

✅ **CORRECT:**
```typescript
// DO: Always resolve plan from database
const result = await exportWorkerV1({
  datasetId,
  format,
  userId, // Plan resolved internally from database
});
```

### Source of Truth

The permission resolver:
1. Queries `subscriptions` table (populated by Stripe webhooks)
2. Uses `getUserPlan()` which checks active subscriptions
3. Falls back to 'demo' if no active subscription found
4. Never uses client-provided plan information

## Error Handling

If database query fails:
- Defaults to 'demo' plan permissions
- Logs error for monitoring
- Never throws - graceful degradation

## Migration

No migration needed - uses existing `subscriptions` table populated by Stripe webhooks.
