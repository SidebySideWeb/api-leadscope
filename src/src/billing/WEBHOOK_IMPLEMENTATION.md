# Stripe Webhook Implementation - Complete Guide

Hardened Stripe webhook handling with database persistence and automatic downgrades.

## Architecture

```
Stripe Webhook → Next.js API Route → Database
                     ↓
              Signature Verification (Required)
                     ↓
              Event Handler
                     ↓
              Database Persistence
```

## Security

### 1. Webhook Signature Verification

**Required**: All webhook requests MUST include a valid `stripe-signature` header.

```typescript
// Signature verification (required)
const event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
```

**If signature is missing or invalid**: Returns 400 error, event is not processed.

### 2. Never Trust Client Input

- **Plan changes**: Only webhook can change user plans
- **User ID**: Extracted from webhook metadata (not from client)
- **Price mapping**: Stripe price ID → internal plan (server-side only)

### 3. Webhook is Plan Authority

- Client cannot directly change plans
- All plan changes come from verified webhook events
- Database is the source of truth

## Event Handlers

### `checkout.session.completed`

**Triggered**: When user completes checkout

**Actions**:
1. Extract `user_id` from session metadata
2. For subscription mode: Retrieve subscription from Stripe
3. Map Stripe price ID to internal plan
4. Persist subscription to database

**Data Persisted**:
- `user_id`
- `stripe_customer_id`
- `stripe_subscription_id`
- `plan` (mapped from price ID)
- `status`
- `current_period_start`
- `current_period_end`

### `customer.subscription.updated`

**Triggered**: When subscription status changes

**Actions**:
1. Extract `user_id` from subscription metadata
2. Map Stripe price ID to internal plan
3. **If status is `canceled` or `past_due`**: Immediately downgrade to demo
4. Update subscription in database

**Downgrade Logic**:
```typescript
if (subscription.status === 'canceled' || subscription.status === 'past_due') {
  await downgradeUserToDemo(userId)
  // User is now on demo plan
}
```

### `customer.subscription.deleted`

**Triggered**: When subscription is deleted

**Actions**:
1. Extract `user_id` from subscription metadata
2. **Immediately downgrade user to demo**
3. Mark subscription as `canceled` in database
4. Set `canceled_at` timestamp

## Price ID Mapping

Maps Stripe price IDs (from environment variables) to internal plan enum:

| Environment Variable | Stripe Price ID | Internal Plan |
|---------------------|----------------|---------------|
| `STRIPE_PRICE_STARTER` | `price_...` | `starter` |
| `STRIPE_PRICE_PROFESSIONAL` | `price_...` | `pro` |
| `STRIPE_PRICE_AGENCY` | `price_...` | `pro` |
| Unknown/None | - | `demo` (fallback) |

## Database Schema

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  stripe_customer_id VARCHAR(255) NOT NULL,
  stripe_subscription_id VARCHAR(255) NOT NULL UNIQUE,
  plan VARCHAR(20) NOT NULL CHECK (plan IN ('demo', 'starter', 'pro')),
  status VARCHAR(50) NOT NULL,
  stripe_price_id VARCHAR(255),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

## Getting User Plan

```typescript
import { getUserPlan } from './db/userPlans.js';

const plan = await getUserPlan('user-123');
// Returns: 'demo' | 'starter' | 'pro'
// Falls back to 'demo' if no active subscription
```

## Downgrade Behavior

When subscription is canceled or past_due:

1. **Immediate Action**: All active subscriptions for user are marked as `canceled`
2. **Plan Effect**: User effectively has no active subscription
3. **Result**: `getUserPlan(userId)` returns `'demo'`
4. **No Grace Period**: Downgrade happens immediately

## Error Handling

- **Signature Verification Failure**: Returns 400, event not processed
- **Missing User ID**: Logs error, returns 500 (Stripe will retry)
- **Database Error**: Returns 500 (Stripe will retry)
- **Unhandled Events**: Logs and returns 200 (no retry needed)

## Testing

### Local Testing with Stripe CLI

```bash
# Install Stripe CLI
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Trigger test events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
```

### Webhook Endpoint

Production: `https://yourdomain.com/api/webhooks/stripe`

## Environment Variables

```env
# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Stripe Price IDs
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PROFESSIONAL=price_...
STRIPE_PRICE_AGENCY=price_...

# Database
DATABASE_URL=postgresql://...
```

## Migration

Run the migration to create the subscriptions table:

```bash
npm run migrate -- create_subscriptions_table.sql
```

## Files

- `src/db/migrations/create_subscriptions_table.sql` - Database schema
- `src/db/subscriptions.ts` - Subscription database functions
- `src/db/userPlans.ts` - User plan retrieval functions
- `src/billing/stripeMapping.ts` - Price ID to plan mapping
- `src/services/stripeWebhook.ts` - Webhook event handlers
- `lead-scope-ai-dashboard/app/api/webhooks/stripe/route.ts` - Next.js webhook endpoint
