import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getUserCredits } from '../services/creditService.js';
import { getCurrentMonthlyUsage, getEffectivePlanLimits, getDatasetBusinessCount } from '../services/planLimitService.js';
import { pool } from '../config/database.js';
import { getActiveSubscriptionForUser } from '../db/subscriptions.js';
import { PLAN_LIMITS, type PlanLimits } from '../config/planLimits.js';
import { CREDIT_COSTS } from '../config/creditCostConfig.js';
import Stripe from 'stripe';

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-01-28.clover',
}) : null;

/**
 * GET /billing/credits
 * Get current credit balance for the authenticated user
 */
router.get('/credits', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const credits = await getUserCredits(userId);
    
    res.json({
      credits,
      currency: 'credits',
    });
  } catch (error: any) {
    console.error('[billing] Error fetching credits:', error);
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
});

/**
 * GET /billing/usage
 * Get current monthly usage statistics
 */
router.get('/usage', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    
    let usage, limits;
    try {
      usage = await getCurrentMonthlyUsage(userId);
    } catch (usageError: any) {
      console.error('[billing] Error getting monthly usage:', usageError);
      throw new Error(`Failed to get usage: ${usageError.message}`);
    }
    
    try {
      limits = await getEffectivePlanLimits(userId);
    } catch (limitsError: any) {
      console.error('[billing] Error getting plan limits:', limitsError);
      throw new Error(`Failed to get limits: ${limitsError.message}`);
    }
    
    // Get credit consumption breakdown (handle case where table might not exist)
    let consumptionByFeature: Array<{ feature: string; credits: number }> = [];
    try {
      const creditBreakdown = await pool.query<{
        reason: string;
        total_consumed: string;
      }>(
        `SELECT 
          reason,
          SUM(ABS(amount)) as total_consumed
        FROM credit_transactions
        WHERE user_id = $1
          AND amount < 0
          AND created_at >= date_trunc('month', CURRENT_DATE)
        GROUP BY reason
        ORDER BY total_consumed DESC`,
        [userId]
      );

      consumptionByFeature = creditBreakdown.rows.map(row => ({
        feature: row.reason,
        credits: parseInt(row.total_consumed || '0', 10),
      }));
    } catch (creditError: any) {
      // If credit_transactions table doesn't exist yet, just return empty array
      console.warn('[billing] Could not fetch credit breakdown (table may not exist):', creditError.message);
      consumptionByFeature = [];
    }

    // Convert Number.MAX_SAFE_INTEGER to null for JSON (Infinity is not JSON-serializable)
    const isUnlimited = (value: number) => value === Number.MAX_SAFE_INTEGER;

    res.json({
      usage: {
        crawls: usage.crawls,
        exports: usage.exports,
        datasets: usage.datasets,
      },
      limits: {
        crawls: isUnlimited(limits.crawls) ? null : limits.crawls,
        exports: isUnlimited(limits.exports) ? null : limits.exports,
        datasets: isUnlimited(limits.datasets) ? null : limits.datasets,
        businessesPerDataset: isUnlimited(limits.businessesPerDataset) ? null : limits.businessesPerDataset,
      },
      consumptionByFeature,
    });
  } catch (error: any) {
    console.error('[billing] Error fetching usage:', error);
    console.error('[billing] Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch usage data', message: error.message });
  }
});

/**
 * GET /billing/subscription
 * Get current subscription information
 */
router.get('/subscription', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    
    // Get user plan from users table
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = userResult.rows[0]?.plan || 'demo';

    // Get active subscription if exists
    const subscription = await getActiveSubscriptionForUser(userId);
    
    const planLimits: PlanLimits = PLAN_LIMITS[userPlan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.demo;
    
    res.json({
      plan: userPlan,
      subscription: subscription ? {
        id: subscription.id,
        status: subscription.status,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        canceled_at: subscription.canceled_at,
      } : null,
      limits: {
        credits: planLimits.credits,
        crawls: planLimits.crawls === Infinity ? null : planLimits.crawls,
        exports: planLimits.exports === Infinity ? null : planLimits.exports,
        datasets: planLimits.datasets === Infinity ? null : planLimits.datasets,
        businessesPerDataset: planLimits.businessesPerDataset === Infinity ? null : planLimits.businessesPerDataset,
      },
    });
  } catch (error: any) {
    console.error('[billing] Error fetching subscription:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

/**
 * POST /billing/checkout
 * Create Stripe checkout session for plan upgrade
 */
router.post('/checkout', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { planId } = req.body;

    if (!planId || !['demo', 'starter', 'pro'].includes(planId)) {
      res.status(400).json({ error: 'Invalid plan ID' });
      return;
    }

    // Map plan ID to Stripe price ID (configure these in your Stripe dashboard)
    const priceIdMap: Record<string, string> = {
      starter: process.env.STRIPE_PRICE_ID_STARTER || '',
      pro: process.env.STRIPE_PRICE_ID_PRO || '',
    };

    const priceId = priceIdMap[planId];
    if (!priceId) {
      res.status(400).json({ error: 'Stripe price ID not configured for this plan' });
      return;
    }

    if (!stripe) {
      res.status(500).json({ error: 'Stripe not configured' });
      return;
    }

    // Get user email
    const userResult = await pool.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [userId]
    );
    const userEmail = userResult.rows[0]?.email;

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer_email: userEmail,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'https://www.leadscope.gr'}/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://www.leadscope.gr'}/billing?canceled=true`,
      metadata: {
        userId,
        planId,
      },
      subscription_data: {
        metadata: {
          userId,
          planId,
        },
      },
    });

    res.json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error: any) {
    console.error('[billing] Error creating checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * POST /billing/buy-credits
 * Create Stripe checkout session for credit purchase
 */
router.post('/buy-credits', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { creditPackage } = req.body;

    // Define credit packages
    const creditPackages: Record<string, { credits: number; priceId: string }> = {
      '500': {
        credits: 500,
        priceId: process.env.STRIPE_PRICE_ID_CREDITS_500 || '',
      },
      '1000': {
        credits: 1000,
        priceId: process.env.STRIPE_PRICE_ID_CREDITS_1000 || '',
      },
      '5000': {
        credits: 5000,
        priceId: process.env.STRIPE_PRICE_ID_CREDITS_5000 || '',
      },
    };

    const packageData = creditPackages[creditPackage];
    if (!packageData || !packageData.priceId) {
      res.status(400).json({ error: 'Invalid credit package or price ID not configured' });
      return;
    }

    if (!stripe) {
      res.status(500).json({ error: 'Stripe not configured' });
      return;
    }

    // Get user email
    const userResult = await pool.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [userId]
    );
    const userEmail = userResult.rows[0]?.email;

    // Create Stripe checkout session for one-time payment
    const session = await stripe.checkout.sessions.create({
      customer_email: userEmail,
      payment_method_types: ['card'],
      line_items: [
        {
          price: packageData.priceId,
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'https://www.leadscope.gr'}/billing?success=true&credits=${packageData.credits}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://www.leadscope.gr'}/billing?canceled=true`,
      metadata: {
        userId,
        credits: packageData.credits.toString(),
        type: 'credit_purchase',
      },
    });

    res.json({
      url: session.url,
      sessionId: session.id,
      credits: packageData.credits,
    });
  } catch (error: any) {
    console.error('[billing] Error creating credit purchase session:', error);
    res.status(500).json({ error: 'Failed to create credit purchase session' });
  }
});

/**
 * GET /billing/credit-costs
 * Get credit cost configuration (for UI display)
 */
router.get('/credit-costs', authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json({
      costs: CREDIT_COSTS,
    });
  } catch (error: any) {
    console.error('[billing] Error fetching credit costs:', error);
    res.status(500).json({ error: 'Failed to fetch credit costs' });
  }
});

export default router;
