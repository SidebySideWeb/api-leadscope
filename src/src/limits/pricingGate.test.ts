/**
 * Pricing Gate Module Tests
 * 
 * Example usage and test cases for the pricing gate module
 */

import { checkPricingGate, getPlanLimit, assertPricingGate } from './pricingGate';

// Example: Export Worker Usage
export function exampleExportWorker(plan: 'demo' | 'starter' | 'pro', requestedRows: number) {
  const gate = checkPricingGate(plan, 'export', { exportRows: requestedRows });
  
  if (!gate.allowed) {
    // Return error response
    return {
      error: gate.reason,
      upgrade_hint: gate.upgrade_hint,
      maxRows: gate.limit,
    };
  }
  
  // Proceed with export, applying limit
  const actualRows = Math.min(requestedRows, gate.limit);
  return {
    success: true,
    rowsExported: actualRows,
    limit: gate.limit,
  };
}

// Example: Crawl Worker Usage
export function exampleCrawlWorker(plan: 'demo' | 'starter' | 'pro', requestedPages: number) {
  const gate = checkPricingGate(plan, 'crawl', { crawlPages: requestedPages });
  
  if (!gate.allowed) {
    throw new Error(gate.reason || 'Crawl not allowed');
  }
  
  // Use limit for crawl configuration
  const maxPages = gate.limit;
  return {
    maxPages,
    allowed: true,
  };
}

// Example: Discovery Worker Usage
export function exampleDiscoveryWorker(plan: 'demo' | 'starter' | 'pro', citiesCount: number) {
  const gate = checkPricingGate(plan, 'discover', { citiesPerDataset: citiesCount });
  
  if (!gate.allowed) {
    return {
      error: gate.reason,
      upgrade_hint: gate.upgrade_hint,
    };
  }
  
  return {
    allowed: true,
    maxCities: gate.limit,
  };
}

// Test Cases (for reference)
export const testCases = {
  // Export tests
  exportDemoWithinLimit: () => {
    const result = checkPricingGate('demo', 'export', { exportRows: 50 });
    console.assert(result.allowed === true, 'Demo export 50 rows should be allowed');
    console.assert(result.limit === 50, 'Demo export limit should be 50');
  },
  
  exportDemoExceedsLimit: () => {
    const result = checkPricingGate('demo', 'export', { exportRows: 100 });
    console.assert(result.allowed === false, 'Demo export 100 rows should be denied');
    console.assert(result.limit === 50, 'Demo export limit should be 50');
    console.assert(result.reason?.includes('50'), 'Reason should mention limit');
  },
  
  exportStarterWithinLimit: () => {
    const result = checkPricingGate('starter', 'export', { exportRows: 500 });
    console.assert(result.allowed === true, 'Starter export 500 rows should be allowed');
    console.assert(result.limit === 500, 'Starter export limit should be 500');
  },
  
  exportProUnlimited: () => {
    const result = checkPricingGate('pro', 'export', { exportRows: 10000 });
    console.assert(result.allowed === true, 'Pro export should be unlimited');
  },
  
  // Crawl tests
  crawlDemoWithinLimit: () => {
    const result = checkPricingGate('demo', 'crawl', { crawlPages: 3 });
    console.assert(result.allowed === true, 'Demo crawl 3 pages should be allowed');
    console.assert(result.limit === 3, 'Demo crawl limit should be 3');
  },
  
  crawlDemoExceedsLimit: () => {
    const result = checkPricingGate('demo', 'crawl', { crawlPages: 5 });
    console.assert(result.allowed === false, 'Demo crawl 5 pages should be denied');
    console.assert(result.limit === 3, 'Demo crawl limit should be 3');
  },
  
  // Discover tests
  discoverDemoWithinLimit: () => {
    const result = checkPricingGate('demo', 'discover', { citiesPerDataset: 1 });
    console.assert(result.allowed === true, 'Demo discover 1 city should be allowed');
    console.assert(result.limit === 1, 'Demo discover limit should be 1');
  },
  
  discoverDemoExceedsLimit: () => {
    const result = checkPricingGate('demo', 'discover', { citiesPerDataset: 2 });
    console.assert(result.allowed === false, 'Demo discover 2 cities should be denied');
    console.assert(result.limit === 1, 'Demo discover limit should be 1');
  },
};
