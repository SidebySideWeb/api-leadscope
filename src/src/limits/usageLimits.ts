/**
 * Usage Limits Configuration
 * 
 * Defines monthly limits per plan for:
 * - exports_this_month
 * - crawls_this_month
 * - datasets_created_this_month
 */

import type { UserPlan } from './pricingGate.js';

export interface UsageLimits {
  maxExportsPerMonth: number;
  maxCrawlsPerMonth: number;
  maxDatasetsPerMonth: number;
}

/**
 * Plan-based usage limits
 */
export const USAGE_LIMITS: Record<UserPlan, UsageLimits> = {
  demo: {
    maxExportsPerMonth: 5,
    maxCrawlsPerMonth: 10,
    maxDatasetsPerMonth: 1,
  },
  starter: {
    maxExportsPerMonth: 50,
    maxCrawlsPerMonth: 100,
    maxDatasetsPerMonth: 5,
  },
  pro: {
    maxExportsPerMonth: Number.MAX_SAFE_INTEGER, // Unlimited
    maxCrawlsPerMonth: Number.MAX_SAFE_INTEGER, // Unlimited
    maxDatasetsPerMonth: Number.MAX_SAFE_INTEGER, // Unlimited
  },
};

/**
 * Check if user can perform an action based on usage limits
 * 
 * @param plan - User's plan
 * @param action - Action type
 * @param currentUsage - Current usage count
 * @param isInternalUser - If true, bypasses all usage limits
 */
export function checkUsageLimit(
  plan: UserPlan,
  action: 'export' | 'crawl' | 'dataset',
  currentUsage: number,
  isInternalUser: boolean = false
): {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  reason?: string;
  upgrade_hint?: string;
} {
  // Internal users bypass all usage limits
  if (isInternalUser) {
    return {
      allowed: true,
      limit: Number.MAX_SAFE_INTEGER,
      used: currentUsage,
      remaining: Number.MAX_SAFE_INTEGER,
    };
  }
  
  const limits = USAGE_LIMITS[plan];
  
  let limit: number;
  let actionName: string;
  
  switch (action) {
    case 'export':
      limit = limits.maxExportsPerMonth;
      actionName = 'exports';
      break;
    case 'crawl':
      limit = limits.maxCrawlsPerMonth;
      actionName = 'crawls';
      break;
    case 'dataset':
      limit = limits.maxDatasetsPerMonth;
      actionName = 'datasets';
      break;
  }
  
  const allowed = currentUsage < limit;
  const remaining = Math.max(0, limit - currentUsage);
  
  return {
    allowed,
    limit,
    used: currentUsage,
    remaining,
    reason: !allowed
      ? `${plan === 'demo' ? 'Demo' : plan === 'starter' ? 'Starter' : 'Pro'} plan allows ${limit} ${actionName} per month. You've used ${currentUsage}.`
      : undefined,
    upgrade_hint: !allowed
      ? plan === 'demo'
        ? 'Upgrade to Starter plan for more monthly exports.'
        : plan === 'starter'
        ? 'Upgrade to Pro plan for unlimited exports.'
        : undefined
      : undefined,
  };
}
