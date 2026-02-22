/**
 * Stripe Credit Packages Service
 * Fetches credit packages from Stripe products
 * 
 * To set up credit packages in Stripe:
 * 1. Create a product for each credit package (e.g., "50 Credits", "100 Credits", "200 Credits")
 * 2. Add metadata to the product:
 *    - type: "credit_package" (optional, but recommended)
 *    - credits: number of credits (e.g., "50", "100", "200")
 *    - bonus: bonus percentage (e.g., "0", "20", "30") - optional
 * 3. Create a one-time payment price for each product
 * 4. The service will automatically detect and fetch these packages
 */

import Stripe from 'stripe';

export interface CreditPackage {
  id: string; // Stripe price ID
  productId: string; // Stripe product ID
  name: string;
  priceEUR: number;
  credits: number;
  bonus: string; // e.g., "20%" or "0%"
}

/**
 * Fetch credit packages from Stripe
 * Looks for products with metadata.type = 'credit_package'
 */
export async function fetchStripeCreditPackages(): Promise<CreditPackage[]> {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  
  if (!stripeSecretKey) {
    console.warn('[Stripe] STRIPE_SECRET_KEY not configured, using fallback packages');
    return getFallbackPackages();
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2026-01-28.clover',
  });

  try {
    // Fetch all products with metadata.type = 'credit_package'
    const products = await stripe.products.list({
      limit: 100,
      active: true,
    });

    const creditPackages: CreditPackage[] = [];

    for (const product of products.data) {
      // Check if this is a credit package (via metadata)
      // Look for: metadata.type = 'credit_package', or metadata.credits set, or product name contains "credit"
      const metadata = product.metadata || {};
      const isCreditPackage = 
        metadata.type === 'credit_package' || 
        metadata.credits !== undefined ||
        product.name.toLowerCase().includes('credit');

      if (!isCreditPackage) {
        continue;
      }

      // Get all active prices for this product (one-time payments only)
      const prices = await stripe.prices.list({
        product: product.id,
        active: true,
        type: 'one_time', // Only one-time payments for credit packages
      });

      if (prices.data.length === 0) {
        // If no one-time prices, check for any active price
        const allPrices = await stripe.prices.list({
          product: product.id,
          active: true,
          limit: 1,
        });
        
        if (allPrices.data.length === 0) {
          console.warn(`[Stripe] No active price found for product ${product.id}`);
          continue;
        }
      }

      // Use the first price (or the one-time price if available)
      const price = prices.data.length > 0 ? prices.data[0] : (await stripe.prices.list({
        product: product.id,
        active: true,
        limit: 1,
      })).data[0];

      if (!price) {
        continue;
      }

      const priceEUR = (price.unit_amount || 0) / 100; // Convert from cents

      // Get credits from metadata (preferred) or calculate from price
      const credits = metadata.credits 
        ? parseInt(metadata.credits, 10)
        : Math.round(priceEUR); // Fallback: 1 credit per euro

      // Get bonus percentage from metadata
      const bonusPercent = metadata.bonus 
        ? parseInt(metadata.bonus, 10)
        : 0;

      creditPackages.push({
        id: price.id,
        productId: product.id,
        name: product.name,
        priceEUR,
        credits,
        bonus: bonusPercent > 0 ? `${bonusPercent}%` : '0%',
      });
    }

    // Sort by price (ascending)
    creditPackages.sort((a, b) => a.priceEUR - b.priceEUR);

    if (creditPackages.length === 0) {
      console.warn('[Stripe] No credit packages found, using fallback packages');
      return getFallbackPackages();
    }

    return creditPackages;
  } catch (error: any) {
    console.error('[Stripe] Error fetching credit packages:', error.message);
    return getFallbackPackages();
  }
}

/**
 * Get a specific credit package by price ID
 */
export async function getCreditPackageByPriceId(priceId: string): Promise<CreditPackage | null> {
  const packages = await fetchStripeCreditPackages();
  return packages.find((pkg) => pkg.id === priceId) || null;
}

/**
 * Get a specific credit package by product ID
 */
export async function getCreditPackageByProductId(productId: string): Promise<CreditPackage | null> {
  const packages = await fetchStripeCreditPackages();
  return packages.find((pkg) => pkg.productId === productId) || null;
}

/**
 * Fallback packages if Stripe is not available or no packages found
 */
function getFallbackPackages(): CreditPackage[] {
  return [
    {
      id: 'fallback-1',
      productId: 'fallback-prod-1',
      name: 'Bronze',
      priceEUR: 50,
      credits: 50,
      bonus: '0%',
    },
    {
      id: 'fallback-2',
      productId: 'fallback-prod-2',
      name: 'Silver',
      priceEUR: 100,
      credits: 120,
      bonus: '20%',
    },
    {
      id: 'fallback-3',
      productId: 'fallback-prod-3',
      name: 'Gold',
      priceEUR: 200,
      credits: 260,
      bonus: '30%',
    },
  ];
}
