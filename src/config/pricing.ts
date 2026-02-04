/**
 * Pricing Configuration
 * 
 * IMPORTANT: These are ESTIMATES only, not guarantees.
 * Actual pricing may vary based on:
 * - Market conditions
 * - Data availability
 * - Business size and complexity
 * 
 * These prices are used for cost estimation during discovery.
 * NO billing occurs during discovery - this is estimation only.
 */

/**
 * Export pricing tiers (EUR)
 * Based on number of businesses exported
 */
export const EXPORT_PRICING = [
  { size: 50, price: 9 },
  { size: 100, price: 15 },
  { size: 500, price: 49 },
  { size: 1000, price: 79 },
  { size: 2000, price: 129 },
] as const;

/**
 * Refresh pricing (EUR per business)
 * Based on refresh type
 */
export const REFRESH_PRICING = {
  incompleteOnly: 0.05, // Refresh only businesses missing website/email/phone
  fullRefresh: 0.03,    // Refresh all businesses (bulk discount)
} as const;

/**
 * Calculate export estimates for a given number of businesses
 * Returns only tiers that are <= estimatedBusinesses
 */
export function calculateExportEstimates(estimatedBusinesses: number): Array<{
  size: number;
  priceEUR: number;
}> {
  return EXPORT_PRICING
    .filter(tier => tier.size <= estimatedBusinesses)
    .map(tier => ({
      size: tier.size,
      priceEUR: tier.price,
    }));
}

/**
 * Calculate refresh estimates
 * @param estimatedBusinesses - Total businesses discovered
 * @param incompleteRate - Estimated rate of incomplete businesses (0-1), default 0.3 (30%)
 */
export function calculateRefreshEstimates(
  estimatedBusinesses: number,
  incompleteRate: number = 0.3
): {
  incompleteOnly: {
    pricePerBusinessEUR: number;
    estimatedTotalEUR: number;
  };
  fullRefresh: {
    pricePerBusinessEUR: number;
    estimatedTotalEUR: number;
  };
} {
  const incompleteBusinesses = Math.ceil(estimatedBusinesses * incompleteRate);
  
  return {
    incompleteOnly: {
      pricePerBusinessEUR: REFRESH_PRICING.incompleteOnly,
      estimatedTotalEUR: Math.round(incompleteBusinesses * REFRESH_PRICING.incompleteOnly * 100) / 100,
    },
    fullRefresh: {
      pricePerBusinessEUR: REFRESH_PRICING.fullRefresh,
      estimatedTotalEUR: Math.round(estimatedBusinesses * REFRESH_PRICING.fullRefresh * 100) / 100,
    },
  };
}
