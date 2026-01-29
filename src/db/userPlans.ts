/**
 * User Plan Database Functions
 * 
 * Gets user's current plan from subscriptions table.
 * Falls back to 'demo' if no active subscription.
 */

import { pool } from '../config/database.js';

export type Plan = 'demo' | 'starter' | 'pro';

/**
 * Get user's current plan from active subscription
 * Falls back to 'demo' if no active subscription
 */
export async function getUserPlan(userId: string): Promise<Plan> {
  const result = await pool.query<{ plan: Plan }>(
    `SELECT plan FROM subscriptions
     WHERE user_id = $1
       AND status IN ('active', 'trialing')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );

  return result.rows[0]?.plan || 'demo';
}

/**
 * Get user's subscription details
 */
export async function getUserSubscription(userId: string): Promise<{
  plan: Plan;
  status: string;
  stripe_subscription_id: string | null;
  current_period_end: Date | null;
} | null> {
  const result = await pool.query<{
    plan: Plan;
    status: string;
    stripe_subscription_id: string | null;
    current_period_end: Date | null;
  }>(
    `SELECT plan, status, stripe_subscription_id, current_period_end
     FROM subscriptions
     WHERE user_id = $1
       AND status IN ('active', 'trialing')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}
