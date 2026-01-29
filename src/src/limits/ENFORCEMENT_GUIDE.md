# Global Pricing Gate Enforcement Guide

Centralized plan limit enforcement across all workers. Limits are business logic, not failures.

## Overview

The `enforcePlanLimits()` function provides a unified way to enforce plan limits across:
- **Discovery Worker**: Cities per dataset
- **Crawl Worker**: Pages per website
- **Export Worker**: Rows per export

## Key Principles

1. **Never Throws Errors**: Limits are business logic, not failures
2. **Graceful Degradation**: Workers stop gracefully when limits hit
3. **Partial Results**: Always return partial results, never empty
4. **Upgrade Hints**: Always include upgrade suggestions when gated

## Usage

### Export Worker

```typescript
import { enforceExportLimits } from '../limits/enforcePlanLimits.js';

// After querying all businesses
const rowsTotal = businesses.length;

// Enforce limits (never throws)
const enforcement = enforceExportLimits(userPlan, rowsTotal);

// Apply limit (enforcement.actual is already capped)
const rowsToExport = enforcement.actual;
const isGated = enforcement.gated;

// Return result with partial data
return {
  success: true,
  rows_returned: rowsToExport,
  rows_total: rowsTotal,
  gated: isGated,
  upgrade_hint: enforcement.upgrade_hint,
  // ... file data
};
```

### Crawl Worker

```typescript
import { enforceCrawlLimits } from '../limits/enforcePlanLimits.js';

// Enforce limits at start
const enforcement = enforceCrawlLimits(userPlan, DEFAULT_MAX_PAGES);
const maxPages = enforcement.actual; // Already capped at plan limit

// During crawl, stop when limit reached
while (queue.length > 0 && visited.size < maxPages) {
  // ... crawl logic
}

// After crawl, check if gated
const finalEnforcement = enforceCrawlLimits(userPlan, visited.size);
const upgradeHint = finalEnforcement.gated ? finalEnforcement.upgrade_hint : undefined;

// Return partial results
return {
  success: true,
  pages_visited: visited.size,
  pages_limit: maxPages,
  gated: visited.size >= maxPages && queue.length > 0,
  upgrade_hint: upgradeHint,
  // ... crawl results
};
```

### Discovery Worker

```typescript
import { enforceDiscoveryLimits } from '../limits/enforcePlanLimits.js';

// Count cities in dataset
const citiesResult = await pool.query(
  `SELECT COUNT(DISTINCT city_id) as count
   FROM businesses WHERE dataset_id = $1`,
  [datasetId]
);
const currentCities = parseInt(citiesResult.rows[0]?.count || '0', 10);
const requestedCities = currentCities + 1; // Adding one more

// Enforce limits (never throws)
const enforcement = enforceDiscoveryLimits(userPlan, requestedCities);
const isGated = enforcement.gated;

// Continue with discovery (will return partial results if gated)
const discoveryResult = await discoverBusinesses({...});

// Return result with gating info
return {
  // ... job result
  gated: isGated,
  upgrade_hint: enforcement.upgrade_hint,
};
```

## Enforcement Result

```typescript
interface EnforcementResult {
  allowed: boolean;      // True if within limits
  limit: number;         // Maximum allowed value
  actual: number;        // Actual value (capped at limit)
  gated: boolean;        // True if limit was hit
  reason?: string;       // Explanation if gated
  upgrade_hint?: string; // Upgrade suggestion if gated
}
```

## Plan Limits

| Plan | Export Rows | Crawl Pages | Discover Cities |
|------|-------------|-------------|-----------------|
| **demo** | 50 | 3 | 1 |
| **starter** | 500 | 15 | 5 |
| **pro** | Unlimited | Unlimited | Unlimited |

## Best Practices

1. **Check Limits Early**: Enforce limits before expensive operations
2. **Return Partial Results**: Never return empty results, always return what was processed
3. **Include Upgrade Hints**: Always provide upgrade suggestions when gated
4. **Log Gating**: Log when limits are hit for monitoring
5. **Never Throw**: Limits are business logic, handle gracefully

## Error Handling

```typescript
// ❌ WRONG: Throwing on limit
if (rowsTotal > limit) {
  throw new Error('Limit exceeded');
}

// ✅ CORRECT: Graceful degradation
const enforcement = enforceExportLimits(userPlan, rowsTotal);
const rowsToExport = enforcement.actual; // Already capped
return {
  rows_returned: rowsToExport,
  rows_total: rowsTotal,
  gated: enforcement.gated,
  upgrade_hint: enforcement.upgrade_hint,
};
```

## Integration Checklist

- [ ] Import enforcement function
- [ ] Check limits before/during processing
- [ ] Apply limits to actual processing
- [ ] Return partial results when gated
- [ ] Include `gated` flag in result
- [ ] Include `upgrade_hint` in result
- [ ] Never throw errors for limits
- [ ] Log gating events for monitoring
