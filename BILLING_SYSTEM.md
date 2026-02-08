# Hybrid Subscription + Credit Billing System

## Overview

The system implements a hybrid billing model combining:
- **Monthly subscription plans** (demo, starter, pro)
- **Credit-based usage billing** for operations
- **Usage tracking** for monthly limits
- **Enforcement** for all operations

## Architecture

### Database Schema

**New Table: `credit_transactions`**
- Tracks all credit additions and consumptions
- Positive amounts = credits added
- Negative amounts = credits consumed
- Links to discovery_runs, exports, datasets via `reference_id`

**Existing Tables Used:**
- `users` - User accounts with `is_internal_user` flag
- `subscriptions` - Stripe subscription data
- `usage_tracking` - Monthly usage counters
- `datasets` - User datasets
- `dataset_businesses` - Dataset-business relationships
- `discovery_runs` - Discovery run records
- `exports` - Export records

## Plan Configuration

### Plan Limits (`src/config/planLimits.ts`)

```typescript
demo:
  credits: 50
  crawls: 1
  exports: 1
  datasets: 1
  businessesPerDataset: 50

starter:
  credits: 500
  crawls: 10
  exports: 10
  datasets: 5
  businessesPerDataset: 2000

pro:
  credits: 3000
  crawls: 100
  exports: 50
  datasets: 20
  businessesPerDataset: unlimited
```

### Credit Costs (`src/config/creditCostConfig.ts`)

```typescript
discoveryBusiness: 0.2 credits
websiteCrawl: 1 credit
emailExtraction: 2 credits
exportRow: 0.1 credits
```

## Services

### 1. Credit Service (`src/services/creditService.ts`)

**Functions:**
- `getUserCredits(userId)` - Get current credit balance
- `addCredits(userId, amount, reason, referenceId?)` - Add credits
- `consumeCredits(userId, amount, reason, referenceId?)` - Consume credits
- `assertCreditsAvailable(userId, amount)` - Assert sufficient credits

**Features:**
- Internal users have unlimited credits
- Credits = sum of all `credit_transactions.amount`
- Throws `CREDIT_LIMIT_REACHED` error if insufficient

### 2. Plan Limit Service (`src/services/planLimitService.ts`)

**Functions:**
- `canCreateDataset(userId)` - Check dataset count limit
- `assertCanCreateDataset(userId)` - Enforce dataset creation
- `canAddBusinessesToDataset(userId, datasetId, additional)` - Check dataset size
- `assertCanAddBusinessesToDataset(...)` - Enforce dataset size
- `canRunCrawl(userId)` - Check crawl limit
- `assertCanRunCrawl(userId)` - Enforce crawl limit
- `canRunExport(userId)` - Check export limit
- `assertCanRunExport(userId)` - Enforce export limit

**Features:**
- Internal users bypass all limits
- Monthly limits reset automatically via `usage_tracking`
- Throws structured errors with error codes

### 3. Enforcement Service (`src/services/enforcementService.ts`)

**Centralized enforcement functions:**
- `enforceDiscoveryRun(userId, estimatedBusinesses)` - Before discovery
- `enforceExport(userId, estimatedRows)` - Before export
- `enforceDatasetCreation(userId)` - Before dataset creation
- `enforceDatasetSize(userId, datasetId, additional)` - Before adding businesses

**Features:**
- Combines plan limits + credit checks
- Internal users bypass all enforcement
- Throws structured errors

### 4. Billing Service (`src/services/billingService.ts`)

**Functions:**
- `allocateMonthlyCredits(userId, plan, reason?)` - Allocate monthly credits
- `handleSubscriptionCreated(data)` - Stripe webhook handler
- `handleSubscriptionUpdated(data)` - Stripe webhook handler
- `handleInvoicePaymentSucceeded(data)` - Stripe webhook handler

**Features:**
- Allocates credits on subscription creation/renewal
- Updates subscription status from Stripe webhooks
- Maps Stripe price IDs to internal plans

## Integration Points

### Discovery Runs

**Before starting:**
1. Check crawl limit (`assertCanRunCrawl`)
2. Estimate credit cost (`calculateDiscoveryCost`)
3. Assert credits available (`assertCreditsAvailable`)

**After completion:**
1. Consume credits based on businesses found
2. Increment crawl usage (`incrementCrawls`)

**Location:** `src/discovery/vriskoWorker.ts`

### Exports

**Before starting:**
1. Check export limit (`assertCanRunExport`)
2. Estimate credit cost (`calculateExportCost`)
3. Assert credits available (`assertCreditsAvailable`)

**After completion:**
1. Consume credits based on rows exported
2. Increment export usage (`incrementExports`)

**Location:** `src/api/exports.ts`

### Dataset Creation

**Before creation:**
1. Check dataset count limit (`assertCanCreateDataset`)

**Location:** `src/services/discoveryService.ts`

### Dataset Size

**Before adding businesses:**
1. Check dataset size limit (`assertCanAddBusinessesToDataset`)

**Location:** `src/discovery/vriskoWorker.ts`

## Error Codes

Structured errors thrown by enforcement:

- `CREDIT_LIMIT_REACHED` - Insufficient credits
- `CRAWL_LIMIT_REACHED` - Monthly crawl limit reached
- `EXPORT_LIMIT_REACHED` - Monthly export limit reached
- `DATASET_LIMIT_REACHED` - Dataset count limit reached
- `DATASET_SIZE_LIMIT_REACHED` - Dataset size limit reached

## Internal Users

Users with `users.is_internal_user = true`:
- Bypass all plan limits
- Have unlimited credits
- Skip all enforcement checks

## Stripe Integration

### Webhook Endpoint

`POST /webhooks/stripe`

**Events handled:**
- `customer.subscription.created` - Create subscription, allocate credits
- `customer.subscription.updated` - Update subscription status
- `invoice.payment_succeeded` - Allocate monthly credits on payment

**Setup:**
1. Configure webhook in Stripe dashboard
2. Set `STRIPE_WEBHOOK_SECRET` environment variable
3. Add Stripe price ID mappings in `billingService.ts`

### Monthly Credit Allocation

Credits are automatically allocated when:
- Subscription is created
- Invoice payment succeeds
- Subscription is renewed

Allocation amount = `PLAN_LIMITS[plan].credits`

## Usage

### Get User Credits

```typescript
import { getUserCredits } from './services/creditService.js';

const credits = await getUserCredits(userId);
console.log(`User has ${credits} credits`);
```

### Check Limits

```typescript
import { enforceDiscoveryRun } from './services/enforcementService.js';

try {
  await enforceDiscoveryRun(userId, estimatedBusinesses);
  // Proceed with discovery
} catch (error) {
  if (error.code === 'CREDIT_LIMIT_REACHED') {
    // Handle insufficient credits
  }
}
```

### Manual Credit Addition

```typescript
import { addCredits } from './services/creditService.js';

await addCredits(
  userId,
  100,
  'Manual credit addition',
  undefined // No reference_id
);
```

## Migration

Run migration to create `credit_transactions` table:

```bash
npm run migrate
# Or manually run: src/db/migrations/create_credit_transactions.sql
```

## Environment Variables

```env
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Testing

Test credit system:

```typescript
// Get credits
const credits = await getUserCredits(userId);

// Add credits
await addCredits(userId, 100, 'Test');

// Consume credits
await consumeCredits(userId, 50, 'Test operation');

// Check balance
const newCredits = await getUserCredits(userId);
console.log(`Credits: ${credits} → ${newCredits}`);
```
