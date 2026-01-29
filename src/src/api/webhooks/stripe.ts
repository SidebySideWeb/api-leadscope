/**
 * Backend Stripe Webhook API Endpoint
 * 
 * This is the backend API that handles Stripe webhook events.
 * Can be called from Next.js webhook handler or directly.
 */

import {
  handleCheckoutSessionCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
} from '../services/stripeWebhook.js';

export interface WebhookEvent {
  type: string;
  data: {
    object: any;
  };
}

/**
 * Process Stripe webhook event
 * 
 * @param event - Stripe event (already verified)
 * @returns Success status
 */
export async function processStripeWebhook(event: WebhookEvent): Promise<{ success: boolean; error?: string }> {
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        await handleCheckoutSessionCompleted(event.data.object);
        return { success: true };
      }

      case 'customer.subscription.updated': {
        await handleSubscriptionUpdated(event.data.object);
        return { success: true };
      }

      case 'customer.subscription.deleted': {
        await handleSubscriptionDeleted(event.data.object);
        return { success: true };
      }

      default:
        console.log(`[processStripeWebhook] Unhandled event type: ${event.type}`);
        return { success: true }; // Don't fail on unhandled events
    }
  } catch (error: any) {
    console.error('[processStripeWebhook] Error:', error);
    return { success: false, error: error.message };
  }
}
