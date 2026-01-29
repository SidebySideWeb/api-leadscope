/**
 * Subscription Database Functions
 * 
 * Manages Stripe subscription data in the database.
 * Webhook is the only plan authority - never trust client input.
 */

import { pool } from '../config/database.js';

export type Plan = 'demo' | 'starter' | 'pro';
export type SubscriptionStatus = 
  | 'active' 
  | 'canceled' 
  | 'past_due' 
  | 'unpaid' 
  | 'incomplete' 
  | 'incomplete_expired' 
  | 'trialing' 
  | 'paused';

export interface Subscription {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan: Plan;
  status: string;
  stripe_price_id: string | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  canceled_at: Date | null;
  is_internal_user: boolean; // If true, bypasses all plan limits
  created_at: Date;
  updated_at: Date;
}

/**
 * Get subscription by Stripe subscription ID
 */
export async function getSubscriptionByStripeId(
  stripeSubscriptionId: string
): Promise<Subscription | null> {
  const result = await pool.query<Subscription>(
    'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1',
    [stripeSubscriptionId]
  );
  return result.rows[0] || null;
}

/**
 * Get active subscription for a user
 */
export async function getActiveSubscriptionForUser(
  userId: string
): Promise<Subscription | null> {
  const result = await pool.query<Subscription>(
    `SELECT *, COALESCE(is_internal_user, false) as is_internal_user
     FROM subscriptions 
     WHERE user_id = $1 
       AND status IN ('active', 'trialing')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Check if user is an internal user (bypasses all limits)
 * Server-side only - never trusts client input
 */
export async function isInternalUser(userId: string): Promise<boolean> {
  const result = await pool.query<{ is_internal_user: boolean }>(
    `SELECT COALESCE(is_internal_user, false) as is_internal_user
     FROM subscriptions
     WHERE user_id = $1
       AND status IN ('active', 'trialing')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0]?.is_internal_user || false;
}

/**
 * Upsert subscription (create or update)
 * Used by webhook handler - webhook is the only plan authority
 */
export async function upsertSubscription(data: {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan: Plan;
  status: string;
  stripe_price_id?: string | null;
  current_period_start?: Date | null;
  current_period_end?: Date | null;
  canceled_at?: Date | null;
}): Promise<Subscription> {
  const result = await pool.query<Subscription>(
    `
    INSERT INTO subscriptions (
      user_id,
      stripe_customer_id,
      stripe_subscription_id,
      plan,
      status,
      stripe_price_id,
      current_period_start,
      current_period_end,
      canceled_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (stripe_subscription_id)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      stripe_price_id = EXCLUDED.stripe_price_id,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      canceled_at = EXCLUDED.canceled_at,
      updated_at = NOW()
    RETURNING *
    `,
    [
      data.user_id,
      data.stripe_customer_id,
      data.stripe_subscription_id,
      data.plan,
      data.status,
      data.stripe_price_id || null,
      data.current_period_start || null,
      data.current_period_end || null,
      data.canceled_at || null,
    ]
  );

  return result.rows[0];
}

/**
 * Update subscription status
 */
export async function updateSubscriptionStatus(
  stripeSubscriptionId: string,
  status: string,
  canceledAt?: Date | null
): Promise<Subscription | null> {
  const result = await pool.query<Subscription>(
    `
    UPDATE subscriptions
    SET status = $2,
        canceled_at = COALESCE($3, canceled_at),
        updated_at = NOW()
    WHERE stripe_subscription_id = $1
    RETURNING *
    `,
    [stripeSubscriptionId, status, canceledAt || null]
  );
  return result.rows[0] || null;
}

/**
 * Downgrade user to demo plan
 * Called when subscription is canceled or past_due
 */
export async function downgradeUserToDemo(userId: string): Promise<void> {
  // Update all active subscriptions for this user to canceled status
  await pool.query(
    `
    UPDATE subscriptions
    SET status = 'canceled',
        updated_at = NOW()
    WHERE user_id = $1
      AND status IN ('active', 'trialing', 'past_due')
    `,
    [userId]
  );

  console.log(`[downgradeUserToDemo] Downgraded user ${userId} to demo plan`);
}
