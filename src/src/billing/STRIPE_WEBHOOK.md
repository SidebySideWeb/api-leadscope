# Stripe Webhook Handler - Hardened Implementation

Production-ready Stripe webhook handling with database persistence and security hardening.

## Security Features

- ✅ **Webhook Signature Verification**: Required - never processes unverified events
- ✅ **Never Trusts Client Input**: All plan data comes from webhook only
- ✅ **Webhook is Plan Authority**: Client cannot change plans - only webhook can
- ✅ **Automatic Downgrades**: Cancellations and past_due immediately downgrade to demo

## Handled Events

### 1. `checkout.session.completed`

**Behavior:**
- Extracts user ID from session metadata or `client_reference_id`
- For subscription mode: Retrieves subscription from Stripe, maps price ID to plan, persists subscription
- For payment mode: Logs one-time payment (no subscription created)

**Data Persisted:**
- `user_id`
- `stripe_customer_id`
- `stripe_subscription_id`
- `plan` (mapped from price ID)
- `status`
- `current_period_start`
- `current_period_end`

### 2. `customer.subscription.updated`

**Behavior:**
- Updates subscription status and plan
- **If status is `canceled` or `past_due`**: Immediately downgrades user to demo
- Persists updated subscription data

**Downgrade Logic:**
```typescript
if (subscription.status === 'canceled' || subscription.status === 'past_due') {
  await downgradeUserToDemo(userId)
  // User is now on demo plan
}
```

### 3. `customer.subscription.deleted`

**Behavior:**
- Immediately downgrades user to demo
- Updates subscription status to `canceled`
- Sets `canceled_at` timestamp

## Price ID to Plan Mapping

Maps Stripe price IDs to internal plan enum:

| Stripe Price ID (env var) | Internal Plan |
|---------------------------|---------------|
| `STRIPE_PRICE_STARTER` | `starter` |
| `STRIPE_PRICE_PROFESSIONAL` | `pro` |
| `STRIPE_PRICE_AGENCY` | `pro` |
| Unknown/None | `demo` (fallback) |

## Database Schema

The `subscriptions` table stores:

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

## Environment Variables

Required in `.env.local`:

```env
# Stripe Keys
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Stripe Price IDs (from Stripe Dashboard)
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PROFESSIONAL=price_...
STRIPE_PRICE_AGENCY=price_...

# Database
DATABASE_URL=postgresql://...
```

## Webhook Setup in Stripe Dashboard

1. Go to [Stripe Dashboard > Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://yourdomain.com/api/webhooks/stripe`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`

## Usage

### Get User Plan

```typescript
import { getUserPlan } from './db/userPlans.js';

const plan = await getUserPlan('user-123');
// Returns: 'demo' | 'starter' | 'pro'
```

### Check Subscription Status

```typescript
import { getUserSubscription } from './db/userPlans.js';

const subscription = await getUserSubscription('user-123');
if (subscription) {
  console.log(`Plan: ${subscription.plan}, Status: ${subscription.status}`);
} else {
  console.log('No active subscription (demo plan)');
}
```

## Security Notes

1. **Signature Verification**: Webhook signature is verified before processing any event
2. **No Client Input**: Plan changes can only come from webhook events
3. **Idempotency**: Webhook can be safely retried (UPSERT logic)
4. **Error Handling**: Returns 500 on error so Stripe will retry
5. **Logging**: All events are logged for audit trail

## Downgrade Behavior

When subscription is canceled or past_due:
- All active subscriptions for the user are marked as `canceled`
- User effectively has no active subscription
- `getUserPlan()` will return `'demo'`
- Downgrade happens immediately (no grace period)

## Migration

Run the migration to create the subscriptions table:

```bash
npm run migrate -- create_subscriptions_table.sql
```
