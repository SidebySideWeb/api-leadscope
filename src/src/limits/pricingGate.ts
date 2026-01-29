/**
 * Pricing Gate Module
 * 
 * Centralized pricing enforcement for all actions (export, crawl, discover)
 * Reusable by export worker, crawl worker, and discovery worker
 */

export type UserPlan = 'demo' | 'starter' | 'pro';
export type ActionType = 'export' | 'crawl' | 'discover';

export interface PricingGateParams {
  // Export params
  exportRows?: number;
  
  // Crawl params
  crawlPages?: number;
  
  // Discover params
  citiesPerDataset?: number;
}

export interface PricingGateResult {
  allowed: boolean;
  limit: number;
  reason?: string;
  upgrade_hint?: string;
}

/**
 * Plan limits configuration
 */
const PLAN_LIMITS: Record<UserPlan, {
  exportMaxRows: number;
  crawlMaxPages: number;
  discoverMaxCities: number;
}> = {
  demo: {
    exportMaxRows: 50,
    crawlMaxPages: 3,
    discoverMaxCities: 1,
  },
  starter: {
    exportMaxRows: 500,
    crawlMaxPages: 15, // From existing entitlements
    discoverMaxCities: 5, // Reasonable default
  },
  pro: {
    exportMaxRows: Number.MAX_SAFE_INTEGER, // Unlimited
    crawlMaxPages: Number.MAX_SAFE_INTEGER, // Unlimited
    discoverMaxCities: Number.MAX_SAFE_INTEGER, // Unlimited
  },
};

/**
 * Get upgrade hint message for a plan
 */
function getUpgradeHint(currentPlan: UserPlan, actionType: ActionType): string {
  if (currentPlan === 'pro') {
    return ''; // No upgrade needed
  }

  const nextPlan = currentPlan === 'demo' ? 'starter' : 'pro';
  const planName = nextPlan === 'starter' ? 'Starter' : 'Pro';

  switch (actionType) {
    case 'export':
      return `Upgrade to ${planName} plan to export more rows.`;
    case 'crawl':
      return `Upgrade to ${planName} plan to crawl more pages per website.`;
    case 'discover':
      return `Upgrade to ${planName} plan to discover businesses in more cities.`;
    default:
      return `Upgrade to ${planName} plan for more features.`;
  }
}

/**
 * Check if an export action is allowed
 */
function checkExport(
  plan: UserPlan,
  requestedRows?: number
): PricingGateResult {
  const limits = PLAN_LIMITS[plan];
  const maxRows = limits.exportMaxRows;

  // If no rows requested, allow (limit will be applied during export)
  if (requestedRows === undefined || requestedRows === null) {
    return {
      allowed: true,
      limit: maxRows,
    };
  }

  // Check if requested rows exceed limit
  if (requestedRows > maxRows) {
    const planName = plan === 'demo' ? 'Demo' : plan === 'starter' ? 'Starter' : 'Pro';
    return {
      allowed: false,
      limit: maxRows,
      reason: `${planName} plan allows up to ${maxRows} rows per export. Requested ${requestedRows} rows.`,
      upgrade_hint: getUpgradeHint(plan, 'export'),
    };
  }

  return {
    allowed: true,
    limit: maxRows,
  };
}

/**
 * Check if a crawl action is allowed
 */
function checkCrawl(
  plan: UserPlan,
  requestedPages?: number
): PricingGateResult {
  const limits = PLAN_LIMITS[plan];
  const maxPages = limits.crawlMaxPages;

  // If no pages requested, allow (limit will be applied during crawl)
  if (requestedPages === undefined || requestedPages === null) {
    return {
      allowed: true,
      limit: maxPages,
    };
  }

  // Check if requested pages exceed limit
  if (requestedPages > maxPages) {
    const planName = plan === 'demo' ? 'Demo' : plan === 'starter' ? 'Starter' : 'Pro';
    return {
      allowed: false,
      limit: maxPages,
      reason: `${planName} plan allows up to ${maxPages} pages per website. Requested ${requestedPages} pages.`,
      upgrade_hint: getUpgradeHint(plan, 'crawl'),
    };
  }

  return {
    allowed: true,
    limit: maxPages,
  };
}

/**
 * Check if a discover action is allowed
 */
function checkDiscover(
  plan: UserPlan,
  citiesPerDataset?: number
): PricingGateResult {
  const limits = PLAN_LIMITS[plan];
  const maxCities = limits.discoverMaxCities;

  // If no cities specified, allow (limit will be applied during discovery)
  if (citiesPerDataset === undefined || citiesPerDataset === null) {
    return {
      allowed: true,
      limit: maxCities,
    };
  }

  // Check if requested cities exceed limit
  if (citiesPerDataset > maxCities) {
    const planName = plan === 'demo' ? 'Demo' : plan === 'starter' ? 'Starter' : 'Pro';
    return {
      allowed: false,
      limit: maxCities,
      reason: `${planName} plan allows up to ${maxCities} ${maxCities === 1 ? 'city' : 'cities'} per dataset. Requested ${citiesPerDataset} cities.`,
      upgrade_hint: getUpgradeHint(plan, 'discover'),
    };
  }

  return {
    allowed: true,
    limit: maxCities,
  };
}

/**
 * Main pricing gate function
 * 
 * @param plan - User's plan (demo | starter | pro)
 * @param actionType - Type of action (export | crawl | discover)
 * @param params - Action-specific parameters
 * @returns Pricing gate result with allowed status, limits, and messages
 * 
 * @example
 * ```typescript
 * // Check export
 * const result = checkPricingGate('demo', 'export', { exportRows: 100 });
 * if (!result.allowed) {
 *   throw new Error(result.reason);
 * }
 * 
 * // Check crawl
 * const result = checkPricingGate('demo', 'crawl', { crawlPages: 5 });
 * 
 * // Check discover
 * const result = checkPricingGate('demo', 'discover', { citiesPerDataset: 2 });
 * ```
 */
export function checkPricingGate(
  plan: UserPlan,
  actionType: ActionType,
  params: PricingGateParams = {}
): PricingGateResult {
  // Validate plan
  if (!['demo', 'starter', 'pro'].includes(plan)) {
    return {
      allowed: false,
      limit: 0,
      reason: `Invalid plan: ${plan}. Expected one of: demo, starter, pro.`,
    };
  }

  // Route to appropriate checker
  switch (actionType) {
    case 'export':
      return checkExport(plan, params.exportRows);
    
    case 'crawl':
      return checkCrawl(plan, params.crawlPages);
    
    case 'discover':
      return checkDiscover(plan, params.citiesPerDataset);
    
    default:
      return {
        allowed: false,
        limit: 0,
        reason: `Unknown action type: ${actionType}. Expected one of: export, crawl, discover.`,
      };
  }
}

/**
 * Get plan limits for a specific action type
 * Useful for displaying limits in UI or logging
 */
export function getPlanLimit(plan: UserPlan, actionType: ActionType): number {
  const limits = PLAN_LIMITS[plan];
  
  switch (actionType) {
    case 'export':
      return limits.exportMaxRows;
    case 'crawl':
      return limits.crawlMaxPages;
    case 'discover':
      return limits.discoverMaxCities;
    default:
      return 0;
  }
}

/**
 * Assert that an action is allowed (throws if not)
 * Convenience function for workers that want to throw on violation
 */
export function assertPricingGate(
  plan: UserPlan,
  actionType: ActionType,
  params: PricingGateParams = {}
): void {
  const result = checkPricingGate(plan, actionType, params);
  
  if (!result.allowed) {
    const message = result.reason || `Action "${actionType}" not allowed for plan "${plan}"`;
    const hint = result.upgrade_hint ? ` ${result.upgrade_hint}` : '';
    throw new Error(message + hint);
  }
}
