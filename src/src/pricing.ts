/**
 * Pricing Gates - Shared Code
 * 
 * Source of truth for pricing limits.
 * Enforces limits server-side with explicit errors.
 * UI cannot bypass these limits.
 * 
 * Rules:
 * - demo:
 *   - maxExport = 50
 *   - maxCrawlDepth = 2
 *   - maxCrawls = 20
 * - paid:
 *   - no limits
 */

export type Plan = 'demo' | 'paid';

export interface PricingLimits {
  maxExport: number;
  maxCrawlDepth: number;
  maxCrawls: number;
}

/**
 * Plan limits configuration
 * This is the source of truth for all pricing limits
 */
const PLAN_LIMITS: Record<Plan, PricingLimits> = {
  demo: {
    maxExport: 50,
    maxCrawlDepth: 2,
    maxCrawls: 20,
  },
  paid: {
    maxExport: Number.MAX_SAFE_INTEGER, // No limit
    maxCrawlDepth: Number.MAX_SAFE_INTEGER, // No limit
    maxCrawls: Number.MAX_SAFE_INTEGER, // No limit
  },
};

/**
 * Get limits for a plan
 */
export function getPlanLimits(plan: Plan): PricingLimits {
  return PLAN_LIMITS[plan];
}

/**
 * Check if export is allowed
 * 
 * @param plan - User's plan
 * @param exportRows - Number of rows requested
 * @returns True if allowed, false otherwise
 * @throws Error if not allowed (explicit error for server-side enforcement)
 */
export function checkExport(plan: Plan, exportRows: number): boolean {
  const limits = getPlanLimits(plan);
  
  if (exportRows > limits.maxExport) {
    throw new Error(
      `Export limit exceeded. Demo plan allows up to ${limits.maxExport} rows. ` +
      `Requested ${exportRows} rows. Upgrade to paid plan for unlimited exports.`
    );
  }
  
  return true;
}

/**
 * Check if crawl depth is allowed
 * 
 * @param plan - User's plan
 * @param crawlDepth - Maximum crawl depth requested
 * @returns True if allowed, false otherwise
 * @throws Error if not allowed (explicit error for server-side enforcement)
 */
export function checkCrawlDepth(plan: Plan, crawlDepth: number): boolean {
  const limits = getPlanLimits(plan);
  
  if (crawlDepth > limits.maxCrawlDepth) {
    throw new Error(
      `Crawl depth limit exceeded. Demo plan allows up to depth ${limits.maxCrawlDepth}. ` +
      `Requested depth ${crawlDepth}. Upgrade to paid plan for unlimited crawl depth.`
    );
  }
  
  return true;
}

/**
 * Check if number of crawls is allowed
 * 
 * @param plan - User's plan
 * @param crawlCount - Number of crawls requested/used
 * @returns True if allowed, false otherwise
 * @throws Error if not allowed (explicit error for server-side enforcement)
 */
export function checkCrawlCount(plan: Plan, crawlCount: number): boolean {
  const limits = getPlanLimits(plan);
  
  if (crawlCount > limits.maxCrawls) {
    throw new Error(
      `Crawl count limit exceeded. Demo plan allows up to ${limits.maxCrawls} crawls. ` +
      `Requested ${crawlCount} crawls. Upgrade to paid plan for unlimited crawls.`
    );
  }
  
  return true;
}

/**
 * Assert export limit (throws if exceeded)
 * Convenience function for server-side enforcement
 */
export function assertExport(plan: Plan, exportRows: number): void {
  checkExport(plan, exportRows);
}

/**
 * Assert crawl depth limit (throws if exceeded)
 * Convenience function for server-side enforcement
 */
export function assertCrawlDepth(plan: Plan, crawlDepth: number): void {
  checkCrawlDepth(plan, crawlDepth);
}

/**
 * Assert crawl count limit (throws if exceeded)
 * Convenience function for server-side enforcement
 */
export function assertCrawlCount(plan: Plan, crawlCount: number): void {
  checkCrawlCount(plan, crawlCount);
}

/**
 * Get export limit for a plan
 * Useful for UI display (read-only, cannot bypass)
 */
export function getExportLimit(plan: Plan): number {
  return getPlanLimits(plan).maxExport;
}

/**
 * Get crawl depth limit for a plan
 * Useful for UI display (read-only, cannot bypass)
 */
export function getCrawlDepthLimit(plan: Plan): number {
  return getPlanLimits(plan).maxCrawlDepth;
}

/**
 * Get crawl count limit for a plan
 * Useful for UI display (read-only, cannot bypass)
 */
export function getCrawlCountLimit(plan: Plan): number {
  return getPlanLimits(plan).maxCrawls;
}

/**
 * Check if plan is paid
 */
export function isPaidPlan(plan: Plan): boolean {
  return plan === 'paid';
}

/**
 * Check if plan is demo
 */
export function isDemoPlan(plan: Plan): boolean {
  return plan === 'demo';
}
