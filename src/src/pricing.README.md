# Pricing Gates - Shared Code

Source of truth for pricing limits. Enforces limits server-side with explicit errors. UI cannot bypass these limits.

## Rules

### Demo Plan
- **maxExport**: 50 rows
- **maxCrawlDepth**: 2 levels
- **maxCrawls**: 20 total crawls

### Paid Plan
- **maxExport**: Unlimited
- **maxCrawlDepth**: Unlimited
- **maxCrawls**: Unlimited

## Usage

### Server-Side Enforcement

```typescript
import { assertExport, assertCrawlDepth, assertCrawlCount, type Plan } from './pricing.js';

// In export worker
try {
  assertExport(plan, totalRows); // Throws if exceeded
  // ... perform export ...
} catch (error) {
  // Handle error (return 403 to client)
  return { error: error.message };
}

// In crawl worker
try {
  assertCrawlDepth(plan, maxDepth); // Throws if exceeded
  // ... perform crawl ...
} catch (error) {
  // Handle error
  return { error: error.message };
}

// Check crawl count
try {
  assertCrawlCount(plan, currentCrawlCount); // Throws if exceeded
  // ... perform crawl ...
} catch (error) {
  // Handle error
  return { error: error.message };
}
```

### Read Limits (UI Display)

```typescript
import { getExportLimit, getCrawlDepthLimit, getCrawlCountLimit, type Plan } from './pricing.js';

// UI can read limits for display, but cannot bypass
const limits = {
  export: getExportLimit(plan),
  crawlDepth: getCrawlDepthLimit(plan),
  crawlCount: getCrawlCountLimit(plan),
};

// Display in UI: "Demo plan: 50 rows max"
```

## API

### Functions

#### `assertExport(plan: Plan, exportRows: number): void`
Throws error if export rows exceed limit.

#### `assertCrawlDepth(plan: Plan, crawlDepth: number): void`
Throws error if crawl depth exceeds limit.

#### `assertCrawlCount(plan: Plan, crawlCount: number): void`
Throws error if crawl count exceeds limit.

#### `checkExport(plan: Plan, exportRows: number): boolean`
Returns true if allowed, throws error if not.

#### `checkCrawlDepth(plan: Plan, crawlDepth: number): boolean`
Returns true if allowed, throws error if not.

#### `checkCrawlCount(plan: Plan, crawlCount: number): boolean`
Returns true if allowed, throws error if not.

#### `getExportLimit(plan: Plan): number`
Returns export limit for plan (read-only, for UI display).

#### `getCrawlDepthLimit(plan: Plan): number`
Returns crawl depth limit for plan (read-only, for UI display).

#### `getCrawlCountLimit(plan: Plan): number`
Returns crawl count limit for plan (read-only, for UI display).

#### `getPlanLimits(plan: Plan): PricingLimits`
Returns all limits for a plan.

#### `isPaidPlan(plan: Plan): boolean`
Returns true if plan is paid.

#### `isDemoPlan(plan: Plan): boolean`
Returns true if plan is demo.

## Error Messages

All functions throw explicit errors with clear messages:

- **Export**: `"Export limit exceeded. Demo plan allows up to 50 rows. Requested X rows. Upgrade to paid plan for unlimited exports."`
- **Crawl Depth**: `"Crawl depth limit exceeded. Demo plan allows up to depth 2. Requested depth X. Upgrade to paid plan for unlimited crawl depth."`
- **Crawl Count**: `"Crawl count limit exceeded. Demo plan allows up to 20 crawls. Requested X crawls. Upgrade to paid plan for unlimited crawls."`

## Server-Side Only

**Important**: All limit checks must be performed server-side. The UI can read limits for display purposes, but cannot bypass them. All API routes and workers must call `assert*` functions before processing requests.

## Integration

### Export Worker

```typescript
import { assertExport, getExportLimit } from '../pricing.js';

export async function exportWorker(plan: Plan, totalRows: number) {
  // Enforce limit (throws if exceeded)
  assertExport(plan, totalRows);
  
  // Get limit and cap rows
  const limit = getExportLimit(plan);
  const rowsToExport = Math.min(totalRows, limit);
  
  // ... export logic ...
}
```

### Crawl Worker

```typescript
import { assertCrawlDepth, getCrawlDepthLimit } from '../pricing.js';

export async function crawlWorker(plan: Plan, maxDepth: number) {
  // Enforce limit (throws if exceeded)
  assertCrawlDepth(plan, maxDepth);
  
  // Get limit and cap depth
  const limit = getCrawlDepthLimit(plan);
  const actualDepth = Math.min(maxDepth, limit);
  
  // ... crawl logic ...
}
```

### API Route

```typescript
import { assertExport } from '../pricing.js';

export async function POST(request: Request) {
  const { plan, exportRows } = await request.json();
  
  try {
    // Enforce limit (throws if exceeded)
    assertExport(plan, exportRows);
    
    // Process request
    return Response.json({ success: true });
  } catch (error: any) {
    // Return error to client
    return Response.json(
      { error: error.message },
      { status: 403 }
    );
  }
}
```

## Testing

```typescript
import { assertExport, assertCrawlDepth, assertCrawlCount } from './pricing.js';

// Test demo limits
try {
  assertExport('demo', 51); // Should throw
} catch (error) {
  console.log('Expected error:', error.message);
}

// Test paid (no limits)
assertExport('paid', 1000); // Should not throw
assertCrawlDepth('paid', 10); // Should not throw
assertCrawlCount('paid', 100); // Should not throw
```
