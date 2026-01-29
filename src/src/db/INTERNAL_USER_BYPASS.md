# Internal User Bypass

Server-side only feature that allows internal users to bypass all plan limits, export caps, and enables re-crawls.

## Overview

Internal users (`is_internal_user === true`) bypass:
- **Plan limits**: Export rows, crawl depth, dataset count
- **Export caps**: Unlimited rows per export
- **Usage limits**: Unlimited monthly exports, crawls, datasets
- **Re-crawls**: Can re-crawl websites without restrictions

## Database Schema

The `is_internal_user` flag is stored in the `subscriptions` table:

```sql
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS is_internal_user BOOLEAN NOT NULL DEFAULT false;
```

## Security

**Server-Side Only**:
- Flag is stored in database, never sent to client
- Cannot be set via API or client requests
- Only database administrators can set this flag
- All checks happen server-side in backend code

## Implementation

### 1. User Permissions

The `getUserPermissions()` function checks for internal user flag:

```typescript
const permissions = await getUserPermissions(userId);
const isInternalUser = permissions.is_internal_user;

// Internal users get unlimited permissions
if (isInternalUser) {
  return {
    plan,
    max_export_rows: Number.MAX_SAFE_INTEGER, // Unlimited
    max_crawl_pages: 10, // Max safety limit still applies
    max_datasets: Number.MAX_SAFE_INTEGER, // Unlimited
    can_refresh: true,
    is_internal_user: true,
  };
}
```

### 2. Limit Enforcement

All limit enforcement functions check for internal user flag:

**Export Limits**:
```typescript
export function enforceExportLimits(
  plan: UserPlan,
  totalRows: number,
  isInternalUser: boolean = false
): EnforcementResult {
  if (isInternalUser) {
    return {
      allowed: true,
      limit: Number.MAX_SAFE_INTEGER,
      actual: totalRows, // No capping
      gated: false,
    };
  }
  // ... normal enforcement
}
```

**Crawl Limits**:
```typescript
export function enforceCrawlLimits(
  plan: UserPlan,
  pagesRequested: number,
  isInternalUser: boolean = false
): EnforcementResult {
  if (isInternalUser) {
    return {
      allowed: true,
      limit: Number.MAX_SAFE_INTEGER, // No plan limit
      actual: pagesRequested, // No capping
      gated: false,
    };
  }
  // ... normal enforcement
}
```

**Usage Limits**:
```typescript
export function checkUsageLimit(
  plan: UserPlan,
  action: 'export' | 'crawl' | 'dataset',
  currentUsage: number,
  isInternalUser: boolean = false
) {
  if (isInternalUser) {
    return {
      allowed: true,
      limit: Number.MAX_SAFE_INTEGER,
      used: currentUsage,
      remaining: Number.MAX_SAFE_INTEGER,
    };
  }
  // ... normal checks
}
```

### 3. Worker Integration

All workers check for internal user flag:

**Export Worker**:
```typescript
const permissions = await getUserPermissions(userId);
const isInternalUser = permissions.is_internal_user;

// Bypass usage limits
const usageCheck = checkUsageLimit(userPlan, 'export', usage.exports_this_month, isInternalUser);

// Bypass export caps
const maxRows = isInternalUser ? Number.MAX_SAFE_INTEGER : permissions.max_export_rows;
const rowsToExport = isInternalUser ? rowsTotal : Math.min(rowsTotal, maxRows);
```

**Crawl Worker**:
```typescript
const permissions = await getUserPermissions(userId);
const isInternalUser = permissions.is_internal_user;

// Bypass usage limits
const usageCheck = checkUsageLimit(userPlan, 'crawl', usage.crawls_this_month, isInternalUser);

// Get max depth (internal users get max)
const maxCrawlDepth = isInternalUser ? 10 : permissions.max_crawl_pages;
```

**Discovery Service**:
```typescript
const permissions = await getUserPermissions(input.userId);
const isInternalUser = permissions.is_internal_user;

// Bypass usage limits
const usageCheck = checkUsageLimit(userPlan, 'dataset_creation', usage.datasets_created_this_month, isInternalUser);

// Bypass discovery limits
const enforcement = enforceDiscoveryLimits(userPlan, requestedCities, isInternalUser);
```

## Safety Limits Still Apply

Internal users bypass **plan limits** but **safety limits** still apply:
- `MAX_PAGES_PER_CRAWL = 50` (hard limit)
- `MAX_CONCURRENT_CRAWLS = 1` (hard limit)
- `CRAWL_TIMEOUT_MS = 60000` (hard limit)

This ensures system stability even for internal users.

## Setting Internal User Flag

**Database Only** - Cannot be set via API:

```sql
-- Set user as internal
UPDATE subscriptions
SET is_internal_user = true
WHERE user_id = 'user-uuid';

-- Remove internal status
UPDATE subscriptions
SET is_internal_user = false
WHERE user_id = 'user-uuid';
```

## Logging

Internal user actions are logged normally, but with `gated: false` and unlimited limits in metadata.

## Example

```typescript
// Internal user export
const permissions = await getUserPermissions('internal-user-id');
// permissions.is_internal_user === true
// permissions.max_export_rows === Number.MAX_SAFE_INTEGER

// Export all rows without capping
const rowsToExport = rowsTotal; // No limit applied
```

## Benefits

- **Testing**: Internal users can test with unlimited data
- **Support**: Support team can export full datasets
- **Development**: Developers can bypass limits during development
- **Security**: Server-side only, cannot be exploited by clients
