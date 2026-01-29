# Pricing Gate Module

Centralized pricing enforcement for all actions (export, crawl, discover). Reusable by all workers and API routes.

## Quick Start

```typescript
import { checkPricingGate } from './pricingGate';

// Check if export is allowed
const result = checkPricingGate('demo', 'export', { exportRows: 100 });

if (!result.allowed) {
  console.error(result.reason);
  console.log(result.upgrade_hint);
} else {
  console.log(`Allowed up to ${result.limit} rows`);
}
```

## Plan Limits

| Plan | Export Max Rows | Crawl Max Pages | Discover Max Cities |
|------|----------------|-----------------|---------------------|
| demo | 50 | 3 | 1 |
| starter | 500 | 15 | 5 |
| pro | Unlimited | Unlimited | Unlimited |

## API

### `checkPricingGate(plan, actionType, params)`

Main function to check if an action is allowed.

**Parameters:**
- `plan`: `'demo' | 'starter' | 'pro'` - User's plan
- `actionType`: `'export' | 'crawl' | 'discover'` - Type of action
- `params`: `PricingGateParams` - Action-specific parameters
  - `exportRows?: number` - For export action
  - `crawlPages?: number` - For crawl action
  - `citiesPerDataset?: number` - For discover action

**Returns:** `PricingGateResult`
```typescript
{
  allowed: boolean;
  limit: number;
  reason?: string;
  upgrade_hint?: string;
}
```

### `assertPricingGate(plan, actionType, params)`

Throws error if action is not allowed. Convenience function for workers.

### `getPlanLimit(plan, actionType)`

Get the limit for a plan and action type without checking requested values.

## Usage Examples

### Export Worker

```typescript
import { checkPricingGate } from './pricingGate';

async function exportDataset(plan: UserPlan, requestedRows: number) {
  const gate = checkPricingGate(plan, 'export', { exportRows: requestedRows });
  
  if (!gate.allowed) {
    throw new Error(gate.reason);
  }
  
  // Apply limit
  const actualRows = Math.min(requestedRows, gate.limit);
  // ... proceed with export
}
```

### Crawl Worker

```typescript
import { checkPricingGate } from './pricingGate';

async function crawlWebsite(plan: UserPlan, requestedPages: number) {
  const gate = checkPricingGate(plan, 'crawl', { crawlPages: requestedPages });
  
  if (!gate.allowed) {
    return {
      error: gate.reason,
      upgrade_hint: gate.upgrade_hint,
    };
  }
  
  // Use limit for crawl configuration
  const maxPages = gate.limit;
  // ... proceed with crawl
}
```

### Discovery Worker

```typescript
import { checkPricingGate } from './pricingGate';

async function discoverBusinesses(plan: UserPlan, citiesCount: number) {
  const gate = checkPricingGate(plan, 'discover', { 
    citiesPerDataset: citiesCount 
  });
  
  if (!gate.allowed) {
    return {
      error: gate.reason,
      upgrade_hint: gate.upgrade_hint,
    };
  }
  
  // Proceed with discovery
  const maxCities = gate.limit;
  // ... proceed with discovery
}
```

### API Route

```typescript
import { checkPricingGate } from './pricingGate';

export async function POST(request: Request) {
  const { plan, actionType, params } = await request.json();
  
  const gate = checkPricingGate(plan, actionType, params);
  
  return Response.json({
    data: gate.allowed ? { /* action data */ } : null,
    meta: {
      plan_id: plan,
      gated: !gate.allowed,
      total_available: gate.limit,
      total_returned: gate.allowed ? gate.limit : 0,
      gate_reason: gate.reason,
      upgrade_hint: gate.upgrade_hint,
    },
  });
}
```

## Integration with Existing Code

The pricing gate module is designed to work alongside existing entitlements:

- **`src/billing/entitlements.ts`**: Export tier entitlements (columns)
- **`src/limits/pricingGate.ts`**: Action limits (rows, pages, cities)

Both can be used together:
- Use `pricingGate` for action limits (how many rows/pages/cities)
- Use `entitlements` for feature access (which columns/features)

## Testing

See `pricingGate.test.ts` for test cases and usage examples.
