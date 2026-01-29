/**
 * Stripe Price ID to Internal Plan Mapping
 * 
 * Maps Stripe price IDs to internal plan enums.
 * This mapping is used by webhook handler to determine user plan.
 * 
 * IMPORTANT: Never trust client input. Webhook is the only plan authority.
 */

export type Plan = 'demo' | 'starter' | 'pro';

/**
 * Map Stripe price ID to internal plan enum
 * 
 * @param priceId - Stripe price ID from webhook
 * @returns Internal plan enum or null if not found
 */
export function mapStripePriceToPlan(priceId: string | null | undefined): Plan | null {
  if (!priceId) {
    return null;
  }

  // Get price IDs from environment variables
  const priceSnapshot = process.env.STRIPE_PRICE_SNAPSHOT;
  const priceStarter = process.env.STRIPE_PRICE_STARTER;
  const pricePro = process.env.STRIPE_PRICE_PROFESSIONAL;
  const priceAgency = process.env.STRIPE_PRICE_AGENCY;

  // Map price IDs to plans
  // Note: snapshot is one-time, so it doesn't create a subscription
  // starter and pro are subscription plans
  if (priceStarter && priceId === priceStarter) {
    return 'starter';
  }

  if (pricePro && priceId === pricePro) {
    return 'pro';
  }

  // Agency maps to pro (highest tier)
  if (priceAgency && priceId === priceAgency) {
    return 'pro';
  }

  // If no match, return null (will default to demo)
  console.warn(`[mapStripePriceToPlan] Unknown price ID: ${priceId}`);
  return null;
}

/**
 * Get all known Stripe price IDs
 * Useful for validation
 */
export function getKnownStripePriceIds(): string[] {
  const prices: string[] = [];
  
  if (process.env.STRIPE_PRICE_SNAPSHOT) {
    prices.push(process.env.STRIPE_PRICE_SNAPSHOT);
  }
  if (process.env.STRIPE_PRICE_STARTER) {
    prices.push(process.env.STRIPE_PRICE_STARTER);
  }
  if (process.env.STRIPE_PRICE_PROFESSIONAL) {
    prices.push(process.env.STRIPE_PRICE_PROFESSIONAL);
  }
  if (process.env.STRIPE_PRICE_AGENCY) {
    prices.push(process.env.STRIPE_PRICE_AGENCY);
  }

  return prices;
}
