/**
 * Stripe Webhook Handler
 * 
 * Handles Stripe webhook events:
 * - subscription.created
 * - subscription.updated
 * - invoice.payment_succeeded
 * 
 * Updates subscriptions and allocates credits
 */

import express from 'express';
import { handleSubscriptionCreated, handleSubscriptionUpdated, handleInvoicePaymentSucceeded } from '../services/billingService.js';
import { Logger } from '../crawler/vrisko/utils/logger.js';

const logger = new Logger('StripeWebhook');

const router = express.Router();

/**
 * POST /webhooks/stripe
 * Handle Stripe webhook events
 * 
 * Requires Stripe webhook signature verification in production
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // In production, verify webhook signature
    if (process.env.NODE_ENV === 'production' && webhookSecret) {
      // TODO: Add Stripe webhook signature verification
      // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      // const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    }

    // Parse webhook event
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    logger.info(`Received Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'customer.subscription.created':
        await handleSubscriptionCreated({
          customer: event.data.object.customer,
          subscription: event.data.object.id,
          plan: event.data.object.items?.data[0]?.price,
        });
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated({
          customer: event.data.object.customer,
          subscription: event.data.object.id,
          status: event.data.object.status,
          plan: event.data.object.items?.data[0]?.price,
          current_period_start: event.data.object.current_period_start,
          current_period_end: event.data.object.current_period_end,
          canceled_at: event.data.object.canceled_at,
        });
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded({
          customer: event.data.object.customer,
          subscription: event.data.object.subscription,
          amount_paid: event.data.object.amount_paid,
          period_start: event.data.object.period_start,
          period_end: event.data.object.period_end,
        });
        break;

      default:
        logger.info(`Unhandled webhook event type: ${event.type}`);
    }

    // Return 200 to acknowledge receipt
    res.json({ received: true });
  } catch (error: any) {
    logger.error(`Error processing Stripe webhook: ${error.message}`, error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
