/**
 * Stripe Webhook Server Endpoint
 * 
 * Express/HTTP server endpoint for Stripe webhooks.
 * This is the backend API that processes webhook events.
 * 
 * Usage: Can be used with Express, Fastify, or any HTTP server
 */

import { IncomingMessage, ServerResponse } from 'http';
import Stripe from 'stripe';
import {
  handleCheckoutSessionCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
} from '../services/stripeWebhook.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-12-18.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

/**
 * Handle Stripe webhook request
 * 
 * @param req - HTTP request with raw body
 * @param res - HTTP response
 */
export async function handleStripeWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Read raw body (required for signature verification)
  const chunks: Buffer[] = [];
  
  return new Promise((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', async () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        const signature = req.headers['stripe-signature'] as string;

        // Security: Require signature
        if (!signature) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing signature' }));
          resolve();
          return;
        }

        // Security: Verify webhook signature
        let event: Stripe.Event;
        try {
          event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        } catch (err: any) {
          console.error('[webhook] Signature verification failed:', err.message);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Signature verification failed: ${err.message}` }));
          resolve();
          return;
        }

        // Handle the event
        try {
          switch (event.type) {
            case 'checkout.session.completed': {
              const session = event.data.object as Stripe.Checkout.Session;
              await handleCheckoutSessionCompleted(session);
              break;
            }

            case 'customer.subscription.updated': {
              const subscription = event.data.object as Stripe.Subscription;
              await handleSubscriptionUpdated(subscription);
              break;
            }

            case 'customer.subscription.deleted': {
              const subscription = event.data.object as Stripe.Subscription;
              await handleSubscriptionDeleted(subscription);
              break;
            }

            default:
              console.log(`[webhook] Unhandled event type: ${event.type}`);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
          resolve();
        } catch (error: any) {
          console.error('[webhook] Handler error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Webhook handler failed', message: error.message }));
          resolve();
        }
      } catch (error: any) {
        console.error('[webhook] Request processing error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request processing failed' }));
        resolve();
      }
    });

    req.on('error', (error) => {
      console.error('[webhook] Request error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request error' }));
      resolve();
    });
  });
}
