/**
 * Pricing Gate Integration Examples
 * 
 * Shows how to integrate pricing gate into workers
 */

import { checkPricingGate, assertPricingGate, type UserPlan } from './pricingGate';

// ============================================================================
// Export Worker Integration
// ============================================================================

interface ExportWorkerParams {
  userId: string;
  plan: UserPlan;
  datasetId: string;
  requestedRows?: number;
}

export function exportWorkerWithPricingGate(params: ExportWorkerParams) {
  const { plan, requestedRows } = params;

  // Check pricing gate
  const gate = checkPricingGate(plan, 'export', {
    exportRows: requestedRows,
  });

  if (!gate.allowed) {
    // Return error response that can be sent to frontend
    return {
      success: false,
      error: gate.reason,
      upgrade_hint: gate.upgrade_hint,
      meta: {
        plan_id: plan,
        gated: true,
        total_available: gate.limit,
        total_returned: 0,
        gate_reason: gate.reason,
        upgrade_hint: gate.upgrade_hint,
      },
    };
  }

  // Proceed with export, applying limit
  const maxRows = gate.limit;
  const actualRows = requestedRows ? Math.min(requestedRows, maxRows) : maxRows;

  return {
    success: true,
    maxRows: actualRows,
    limit: gate.limit,
    meta: {
      plan_id: plan,
      gated: plan === 'demo' || plan === 'starter',
      total_available: actualRows,
      total_returned: actualRows,
    },
  };
}

// Alternative: Throw on violation (simpler for workers)
export function exportWorkerWithAssertion(plan: UserPlan, requestedRows: number) {
  // This will throw if not allowed
  assertPricingGate(plan, 'export', { exportRows: requestedRows });

  // If we get here, action is allowed
  const gate = checkPricingGate(plan, 'export', { exportRows: requestedRows });
  return gate.limit;
}

// ============================================================================
// Crawl Worker Integration
// ============================================================================

interface CrawlWorkerParams {
  plan: UserPlan;
  requestedPages: number;
  websiteUrl: string;
}

export function crawlWorkerWithPricingGate(params: CrawlWorkerParams) {
  const { plan, requestedPages } = params;

  // Check pricing gate
  const gate = checkPricingGate(plan, 'crawl', {
    crawlPages: requestedPages,
  });

  if (!gate.allowed) {
    return {
      success: false,
      error: gate.reason,
      upgrade_hint: gate.upgrade_hint,
      maxPages: gate.limit,
    };
  }

  // Use limit for crawl configuration
  const maxPages = gate.limit;
  const actualPages = Math.min(requestedPages, maxPages);

  return {
    success: true,
    maxPages: actualPages,
    limit: gate.limit,
  };
}

// ============================================================================
// Discovery Worker Integration
// ============================================================================

interface DiscoveryWorkerParams {
  plan: UserPlan;
  citiesPerDataset: number;
  industryId: number;
}

export function discoveryWorkerWithPricingGate(params: DiscoveryWorkerParams) {
  const { plan, citiesPerDataset } = params;

  // Check pricing gate
  const gate = checkPricingGate(plan, 'discover', {
    citiesPerDataset,
  });

  if (!gate.allowed) {
    return {
      success: false,
      error: gate.reason,
      upgrade_hint: gate.upgrade_hint,
      maxCities: gate.limit,
    };
  }

  // Proceed with discovery
  const maxCities = gate.limit;
  const actualCities = Math.min(citiesPerDataset, maxCities);

  return {
    success: true,
    maxCities: actualCities,
    limit: gate.limit,
  };
}

// ============================================================================
// API Route Integration Example
// ============================================================================

export function apiRouteWithPricingGate(
  plan: UserPlan,
  actionType: 'export' | 'crawl' | 'discover',
  params: { exportRows?: number; crawlPages?: number; citiesPerDataset?: number }
) {
  const gate = checkPricingGate(plan, actionType, params);

  // Return response that frontend can use
  return {
    data: gate.allowed ? { /* action data */ } : null,
    meta: {
      plan_id: plan,
      gated: !gate.allowed,
      total_available: gate.limit,
      total_returned: gate.allowed ? gate.limit : 0,
      gate_reason: gate.reason,
      upgrade_hint: gate.upgrade_hint,
    },
  };
}
