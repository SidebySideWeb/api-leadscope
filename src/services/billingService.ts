/**
 * Billing Service
 * 
 * Handles subscription billing and credit allocation:
 * - Monthly credit allocation on subscription renewal
 * - Stripe webhook integration
 * - Credit balance management
 */

import { addCredits } from './creditService.js';
import { getPlanLimits } from '../config/planLimits.js';
import { upsertSubscription, getSubscriptionByStripeId } from '../db/subscriptions.js';
import { pool } from '../config/database.js';
import type { Plan } from '../db/subscriptions.js';

/**
 * Allocate monthly credits to user based on their plan
 * Called when subscription is created/updated/renewed
 */
export async function allocateMonthlyCredits(
  userId: string,
  plan: Plan,
  reason: string = 'Monthly subscription credits'
): Promise<void> {
  const planLimits = getPlanLimits(plan);
  
  await addCredits(
    userId,
    planLimits.credits,
    reason,
    undefined // No reference_id for monthly allocation
  );
}

/**
 * Handle Stripe subscription created webhook
 */
export async function handleSubscriptionCreated(data: {
  customer: string;
  subscription: string;
  plan?: { id: string; nickname?: string };
}): Promise<void> {
  // Map Stripe plan to internal plan
  // This should match your Stripe price IDs
  const planMapping: Record<string, Plan> = {
    // Add your Stripe price IDs here
    // 'price_starter': 'starter',
    // 'price_pro': 'pro',
  };

  // Get user_id from stripe_customer_id
  // First try to find existing subscription
  const existingSub = await getSubscriptionByStripeId(data.subscription);
  if (existingSub) {
    // Subscription already exists, just update it
    await handleSubscriptionUpdated({
      customer: data.customer,
      subscription: data.subscription,
      status: 'active',
      plan: data.plan,
    });
    return;
  }

  // Try to find user by customer ID
  const userResult = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1`,
    [data.customer]
  );

  if (userResult.rows.length === 0) {
    console.warn(`[billingService] No user found for Stripe customer ${data.customer}`);
    // In some cases, we might need to create the subscription without a user_id
    // This would require additional logic to link customer to user
    return;
  }

  const userId = userResult.rows[0].user_id;
  
  // Determine plan from Stripe data
  const plan = planMapping[data.plan?.id || ''] || 'demo';

  // Upsert subscription
  await upsertSubscription({
    user_id: userId,
    stripe_customer_id: data.customer,
    stripe_subscription_id: data.subscription,
    plan,
    status: 'active',
    stripe_price_id: data.plan?.id || null,
  });

  // Allocate monthly credits
  await allocateMonthlyCredits(userId, plan, `Stripe subscription created: ${data.subscription}`);
}

/**
 * Handle Stripe subscription updated webhook
 */
export async function handleSubscriptionUpdated(data: {
  customer: string;
  subscription: string;
  status: string;
  plan?: { id: string; nickname?: string };
  current_period_start?: number;
  current_period_end?: number;
  canceled_at?: number | null;
}): Promise<void> {
  const subscription = await getSubscriptionByStripeId(data.subscription);
  if (!subscription) {
    console.warn(`[billingService] Subscription ${data.subscription} not found`);
    return;
  }

  const planMapping: Record<string, Plan> = {
    // Add your Stripe price IDs here
  };

  const plan = planMapping[data.plan?.id || ''] || subscription.plan;

  // Update subscription
  await upsertSubscription({
    user_id: subscription.user_id,
    stripe_customer_id: data.customer,
    stripe_subscription_id: data.subscription,
    plan,
    status: data.status,
    stripe_price_id: data.plan?.id || null,
    current_period_start: data.current_period_start ? new Date(data.current_period_start * 1000) : null,
    current_period_end: data.current_period_end ? new Date(data.current_period_end * 1000) : null,
    canceled_at: data.canceled_at ? new Date(data.canceled_at * 1000) : null,
  });
}

/**
 * Handle Stripe invoice payment succeeded webhook
 * Allocates monthly credits on successful payment
 */
export async function handleInvoicePaymentSucceeded(data: {
  customer: string;
  subscription: string;
  amount_paid: number;
  period_start: number;
  period_end: number;
}): Promise<void> {
  const subscription = await getSubscriptionByStripeId(data.subscription);
  if (!subscription) {
    console.warn(`[billingService] Subscription ${data.subscription} not found for invoice payment`);
    return;
  }

  // Allocate monthly credits on successful payment
  await allocateMonthlyCredits(
    subscription.user_id,
    subscription.plan,
    `Stripe invoice payment succeeded: ${data.subscription}`
  );
}

/**
 * Handle Stripe checkout.session.completed webhook
 * Used for one-time credit purchases
 */
export async function handleCheckoutSessionCompleted(session: {
  id: string;
  customer_email?: string;
  metadata?: {
    userId?: string;
    credits?: string;
    priceEUR?: string;
    bonus?: string;
    type?: string;
  };
  amount_total?: number;
}): Promise<void> {
  // Only handle credit purchases (not subscriptions)
  if (session.metadata?.type !== 'credit_purchase') {
    return;
  }

  const userId = session.metadata?.userId;
  const creditsStr = session.metadata?.credits;

  if (!userId || !creditsStr) {
    console.warn(`[billingService] Missing userId or credits in checkout session ${session.id}`);
    return;
  }

  const credits = parseInt(creditsStr, 10);
  if (isNaN(credits) || credits <= 0) {
    console.warn(`[billingService] Invalid credits amount: ${creditsStr}`);
    return;
  }

  // Add credits to user account
  const { addCredits } = await import('./creditService.js');
  await addCredits(
    userId,
    credits,
    `Credit purchase: ${credits} credits (${session.metadata.bonus || '0%'} bonus)`,
    session.id // Use session ID as reference
  );

  console.log(`[billingService] Added ${credits} credits to user ${userId} from checkout session ${session.id}`);
}