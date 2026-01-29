/**
 * Global Pricing Gate Enforcement
 * 
 * Central function for enforcing plan limits across all workers.
 * Never throws errors - limits are business logic, not failures.
 * 
 * Used by:
 * - discovery worker
 * - crawl worker
 * - export worker
 */

import { checkPricingGate, type UserPlan, type ActionType, type PricingGateParams } from './pricingGate.js';

export interface EnforcementResult {
  allowed: boolean;
  limit: number;
  actual: number; // Actual value being processed
  gated: boolean; // True if limit was hit
  reason?: string;
  upgrade_hint?: string;
}

/**
 * Enforce plan limits for any action
 * 
 * This function:
 * - Checks pricing gates
 * - Returns enforcement result (never throws)
 * - Provides upgrade hints
 * - Indicates if limit was hit
 * 
 * @param plan - User's plan
 * @param actionType - Type of action (export, crawl, discover)
 * @param actual - Actual value being processed (rows, pages, cities)
 * @param params - Optional additional params for gate checking
 * @returns Enforcement result with limit info and upgrade hints
 */
export function enforcePlanLimits(
  plan: UserPlan,
  actionType: ActionType,
  actual: number,
  params?: PricingGateParams
): EnforcementResult {
  // Get pricing gate result
  const gate = checkPricingGate(plan, actionType, params || {});
  
  // Determine if limit was hit
  const gated = actual > gate.limit;
  
  // Calculate actual allowed value (capped at limit)
  const allowedValue = Math.min(actual, gate.limit);
  
  return {
    allowed: gate.allowed && !gated,
    limit: gate.limit,
    actual: allowedValue, // What will actually be processed
    gated: gated,
    reason: gated ? gate.reason : undefined,
    upgrade_hint: gated ? gate.upgrade_hint : undefined,
  };
}

/**
 * Enforce export row limits
 * 
 * @param plan - User's plan
 * @param totalRows - Total rows available
 * @param isInternalUser - If true, bypasses all limits
 * @returns Enforcement result
 */
export function enforceExportLimits(
  plan: UserPlan,
  totalRows: number,
  isInternalUser: boolean = false
): EnforcementResult {
  // Internal users bypass all limits
  if (isInternalUser) {
    return {
      allowed: true,
      limit: Number.MAX_SAFE_INTEGER,
      actual: totalRows, // No capping for internal users
      gated: false,
    };
  }
  
  return enforcePlanLimits(plan, 'export', totalRows, {
    exportRows: totalRows,
  });
}

/**
 * Enforce crawl page limits
 * 
 * @param plan - User's plan
 * @param pagesRequested - Number of pages requested/available
 * @param isInternalUser - If true, bypasses all limits (except safety caps)
 * @returns Enforcement result
 */
export function enforceCrawlLimits(
  plan: UserPlan,
  pagesRequested: number,
  isInternalUser: boolean = false
): EnforcementResult {
  // Internal users bypass plan limits (but safety caps still apply)
  if (isInternalUser) {
    return {
      allowed: true,
      limit: Number.MAX_SAFE_INTEGER, // No plan limit, but safety cap (50 pages) still applies
      actual: pagesRequested, // No capping for internal users
      gated: false,
    };
  }
  
  return enforcePlanLimits(plan, 'crawl', pagesRequested, {
    crawlPages: pagesRequested,
  });
}

/**
 * Enforce discovery city limits
 * 
 * @param plan - User's plan
 * @param citiesRequested - Number of cities requested
 * @param isInternalUser - If true, bypasses all limits
 * @returns Enforcement result
 */
export function enforceDiscoveryLimits(
  plan: UserPlan,
  citiesRequested: number,
  isInternalUser: boolean = false
): EnforcementResult {
  // Internal users bypass all limits
  if (isInternalUser) {
    return {
      allowed: true,
      limit: Number.MAX_SAFE_INTEGER,
      actual: citiesRequested, // No capping for internal users
      gated: false,
    };
  }
  
  return enforcePlanLimits(plan, 'discover', citiesRequested, {
    citiesPerDataset: citiesRequested,
  });
}

/**
 * Check if processing should stop due to limit
 * 
 * @param enforcement - Enforcement result
 * @returns True if should stop gracefully
 */
export function shouldStopProcessing(enforcement: EnforcementResult): boolean {
  return enforcement.gated;
}

/**
 * Get upgrade hint message
 * 
 * @param enforcement - Enforcement result
 * @returns Upgrade hint or empty string
 */
export function getUpgradeHint(enforcement: EnforcementResult): string {
  return enforcement.upgrade_hint || '';
}
