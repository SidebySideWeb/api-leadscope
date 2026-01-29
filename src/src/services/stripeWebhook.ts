/**
 * Stripe Webhook Handler Service
 * 
 * Hardened webhook handling with database persistence.
 * Webhook is the only plan authority - never trust client input.
 */

import Stripe from 'stripe';
import { 
  upsertSubscription, 
  updateSubscriptionStatus, 
  downgradeUserToDemo,
  getSubscriptionByStripeId,
  type Plan 
} from '../db/subscriptions.js';
import { mapStripePriceToPlan } from '../billing/stripeMapping.js';
import { pool } from '../config/database.js';

/**
 * Handle checkout.session.completed event
 * Creates subscription record when checkout is completed
 */
export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  // Extract user ID from metadata (webhook is authoritative)
  const userId = session.metadata?.userId || session.client_reference_id;
  
  if (!userId) {
    console.error('[handleCheckoutSessionCompleted] No user ID found in session');
    throw new Error('User ID not found in checkout session');
  }

  // For subscription mode, get the subscription
  if (session.mode === 'subscription' && session.subscription) {
    // Fetch subscription details from Stripe
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-12-18.acacia',
    });

    const subscription = await stripe.subscriptions.retrieve(
      session.subscription as string
    );

    // Map price ID to plan
    const priceId = subscription.items.data[0]?.price.id;
    const plan = mapStripePriceToPlan(priceId) || 'demo';

    // Get customer ID
    const customerId = typeof subscription.customer === 'string' 
      ? subscription.customer 
      : subscription.customer.id;

    // Persist subscription
    await upsertSubscription({
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      plan: plan as Plan,
      status: subscription.status,
      stripe_price_id: priceId,
      current_period_start: new Date(subscription.current_period_start * 1000),
      current_period_end: new Date(subscription.current_period_end * 1000),
      canceled_at: subscription.canceled_at 
        ? new Date(subscription.canceled_at * 1000) 
        : null,
    });

    console.log(`[handleCheckoutSessionCompleted] Subscription created: ${subscription.id} for user ${userId}, plan: ${plan}`);
  } else if (session.mode === 'payment') {
    // One-time payment (snapshot) - no subscription to create
    console.log(`[handleCheckoutSessionCompleted] One-time payment completed for user ${userId}`);
  }
}

/**
 * Handle customer.subscription.updated event
 * Updates subscription status and plan
 */
export async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription
): Promise<void> {
  // Extract user ID from metadata (webhook is authoritative)
  const userId = subscription.metadata?.userId;
  
  if (!userId) {
    console.error('[handleSubscriptionUpdated] No user ID found in subscription metadata');
    // Try to find existing subscription
    const existing = await getSubscriptionByStripeId(subscription.id);
    if (!existing) {
      throw new Error('User ID not found and subscription does not exist');
    }
    // Use existing user_id
    const existingUserId = existing.user_id;
    await handleSubscriptionUpdatedWithUserId(subscription, existingUserId);
    return;
  }

  await handleSubscriptionUpdatedWithUserId(subscription, userId);
}

async function handleSubscriptionUpdatedWithUserId(
  subscription: Stripe.Subscription,
  userId: string
): Promise<void> {
  // Map price ID to plan
  const priceId = subscription.items.data[0]?.price.id;
  const plan = mapStripePriceToPlan(priceId) || 'demo';

  // Get customer ID
  const customerId = typeof subscription.customer === 'string' 
    ? subscription.customer 
    : subscription.customer.id;

  // Check if subscription is canceled or past_due - downgrade to demo
  if (subscription.status === 'canceled' || subscription.status === 'past_due') {
    await downgradeUserToDemo(userId);
    console.log(`[handleSubscriptionUpdated] Downgraded user ${userId} to demo (status: ${subscription.status})`);
  }

  // Persist subscription update
  await upsertSubscription({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    plan: plan as Plan,
    status: subscription.status,
    stripe_price_id: priceId,
    current_period_start: new Date(subscription.current_period_start * 1000),
    current_period_end: new Date(subscription.current_period_end * 1000),
    canceled_at: subscription.canceled_at 
      ? new Date(subscription.canceled_at * 1000) 
      : null,
  });

  console.log(`[handleSubscriptionUpdated] Subscription updated: ${subscription.id} for user ${userId}, plan: ${plan}, status: ${subscription.status}`);
}

/**
 * Handle customer.subscription.deleted event
 * Downgrades user to demo immediately
 */
export async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  // Extract user ID from metadata (webhook is authoritative)
  const userId = subscription.metadata?.userId;
  
  if (!userId) {
    // Try to find existing subscription
    const existing = await getSubscriptionByStripeId(subscription.id);
    if (!existing) {
      console.error('[handleSubscriptionDeleted] No user ID found and subscription does not exist');
      return; // Can't downgrade if we don't know the user
    }
    // Use existing user_id
    await downgradeUserToDemo(existing.user_id);
    await updateSubscriptionStatus(subscription.id, 'canceled', new Date());
    console.log(`[handleSubscriptionDeleted] Subscription deleted: ${subscription.id} for user ${existing.user_id}`);
    return;
  }

  // Downgrade user to demo immediately
  await downgradeUserToDemo(userId);
  
  // Update subscription status
  await updateSubscriptionStatus(subscription.id, 'canceled', new Date());

  console.log(`[handleSubscriptionDeleted] Subscription deleted: ${subscription.id} for user ${userId}, downgraded to demo`);
}

// getUserPlan is exported from ../db/userPlans.js
