# Usage Tracking System

Simple monthly usage tracking per user with automatic monthly reset.

## Overview

Tracks per user:
- `exports_this_month` - Number of exports performed this month
- `crawls_this_month` - Number of crawls performed this month
- `datasets_created_this_month` - Number of datasets created this month

## Features

- **Automatic Monthly Reset**: New record created automatically when month changes
- **Per-User Tracking**: One record per user per month
- **Limit Enforcement**: Integrated with pricing gates
- **Graceful Degradation**: Never throws errors, returns usage info

## Database Schema

```sql
CREATE TABLE usage_tracking (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  month_year VARCHAR(7) NOT NULL, -- Format: 'YYYY-MM'
  exports_this_month INTEGER DEFAULT 0,
  crawls_this_month INTEGER DEFAULT 0,
  datasets_created_this_month INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, month_year)
);
```

## Usage Limits by Plan

| Plan | Max Exports/Month | Max Crawls/Month | Max Datasets/Month |
|------|------------------|------------------|---------------------|
| **demo** | 5 | 10 | 1 |
| **starter** | 50 | 100 | 5 |
| **pro** | Unlimited | Unlimited | Unlimited |

## API

### Get User Usage

```typescript
import { getUserUsage } from '../db/usageTracking.js';

const usage = await getUserUsage(userId);
// Returns: { exports_this_month, crawls_this_month, datasets_created_this_month, month_year }
```

### Increment Counters

```typescript
import { incrementExports, incrementCrawls, incrementDatasets } from '../db/usageTracking.js';

// After successful export
await incrementExports(userId);

// After successful crawl
await incrementCrawls(userId);

// After creating new dataset
await incrementDatasets(userId);
```

### Check Usage Limits

```typescript
import { checkUsageLimit } from '../limits/usageLimits.js';

const usage = await getUserUsage(userId);
const check = checkUsageLimit(userPlan, 'export', usage.exports_this_month);

if (!check.allowed) {
  // Handle limit reached
  console.log(check.reason);
  console.log(check.upgrade_hint);
}
```

## Integration

### Export Worker

```typescript
// 1. Check usage limit before export
const usage = await getUserUsage(userId);
const usageCheck = checkUsageLimit(userPlan, 'export', usage.exports_this_month);

if (!usageCheck.allowed) {
  return { success: false, error: usageCheck.reason, upgrade_hint: usageCheck.upgrade_hint };
}

// 2. Perform export...

// 3. Increment counter on success
await incrementExports(userId);
```

### Crawl Worker

```typescript
// 1. Check usage limit before crawl
const usage = await getUserUsage(userId);
const usageCheck = checkUsageLimit(userPlan, 'crawl', usage.crawls_this_month);

if (!usageCheck.allowed) {
  return { success: false, error: usageCheck.reason, upgrade_hint: usageCheck.upgrade_hint };
}

// 2. Perform crawl...

// 3. Increment counter on success
if (crawlStatus !== 'not_crawled') {
  await incrementCrawls(userId);
}
```

### Discovery Service

```typescript
// 1. Check usage limit before creating dataset
if (input.userPlan) {
  const usage = await getUserUsage(input.userId);
  const usageCheck = checkUsageLimit(input.userPlan, 'dataset', usage.datasets_created_this_month);
  
  if (!usageCheck.allowed) {
    return { errors: [usageCheck.reason], gated: true, upgrade_hint: usageCheck.upgrade_hint };
  }
}

// 2. Create dataset...

// 3. Increment counter only if new dataset created
if (!isReused) {
  await incrementDatasets(input.userId);
}
```

## Monthly Reset

The system automatically resets usage at the start of each month:

1. When `getUserUsage()` is called, it checks if a record exists for the current month
2. If no record exists, a new record is created with all counters at 0
3. The `month_year` field (format: 'YYYY-MM') ensures automatic separation by month

## Migration

Run the migration to create the table:

```bash
npm run migrate -- create_usage_tracking.sql
```

## Notes

- Usage is tracked per user, per month
- Counters are incremented only on successful operations
- Limits are enforced before operations, not after
- Graceful degradation: returns usage info instead of throwing errors
- Pro plan has unlimited usage (Number.MAX_SAFE_INTEGER)
