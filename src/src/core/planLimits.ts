/**
 * Centralized Plan Limits
 * 
 * Single source of truth for all plan-based limits.
 * Used consistently across crawling and exports.
 */

export type Plan = 'demo' | 'starter' | 'pro';

export interface PlanLimits {
  export_max_rows: number;
  crawl_max_depth: number;
  crawl_pages_limit: number;
  crawls_per_month: number;
}

/**
 * Plan limits configuration
 * This is the single source of truth for all plan limits
 */
const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  demo: {
    export_max_rows: 50,
    crawl_max_depth: 1, // Depth 1 only
    crawl_pages_limit: 5,
    crawls_per_month: 50,
  },
  starter: {
    export_max_rows: 1000,
    crawl_max_depth: 2,
    crawl_pages_limit: 25,
    crawls_per_month: Number.MAX_SAFE_INTEGER, // Unlimited for starter
  },
  pro: {
    export_max_rows: 1000000, // Effectively unlimited
    crawl_max_depth: 3,
    crawl_pages_limit: 100,
    crawls_per_month: Number.MAX_SAFE_INTEGER, // Unlimited for pro
  },
};

/**
 * Get plan limits for a plan
 * 
 * @param plan - Plan identifier
 * @returns Plan limits configuration
 */
export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export interface ExportGateResult {
  rows: number; // Actual rows to export (may be capped)
  watermarkText: string; // Watermark text for the export
  gated: boolean; // Whether the export was gated
  originalRows: number; // Original number of rows before gating
}

/**
 * Apply export gate based on plan
 * 
 * @param plan - User's plan
 * @param rows - Number of rows requested
 * @returns Gated result with actual rows to export and watermark
 */
export function applyExportGate(plan: Plan, rows: number): ExportGateResult {
  const limits = getPlanLimits(plan);
  const originalRows = rows;
  
  if (rows > limits.export_max_rows) {
    let watermarkText = '';
    if (plan === 'demo') {
      watermarkText = 'DEMO (max 50 leads)';
    } else if (plan === 'starter') {
      watermarkText = 'STARTER';
    } else {
      watermarkText = 'PRO';
    }
    
    return {
      rows: limits.export_max_rows,
      watermarkText,
      gated: true,
      originalRows,
    };
  }
  
  // No gating needed
  let watermarkText = '';
  if (plan === 'demo') {
    watermarkText = 'DEMO';
  } else if (plan === 'starter') {
    watermarkText = 'STARTER';
  } else {
    watermarkText = 'PRO';
  }
  
  return {
    rows,
    watermarkText,
    gated: false,
    originalRows,
  };
}

export interface CrawlGateResult {
  maxDepth: number; // Actual max depth (may be capped)
  pagesLimit: number; // Actual pages limit (may be capped)
  gated: boolean; // Whether the crawl was gated
  originalDepth: number; // Original requested depth
  originalPagesLimit: number; // Original requested pages limit
}

/**
 * Apply crawl gate based on plan
 * 
 * @param plan - User's plan
 * @param requestedDepth - Requested crawl depth
 * @param requestedPagesLimit - Requested pages limit (optional, defaults to crawl_pages_limit)
 * @returns Gated result with actual max depth and pages limit
 */
export function applyCrawlGate(
  plan: Plan,
  requestedDepth: number,
  requestedPagesLimit?: number
): CrawlGateResult {
  const limits = getPlanLimits(plan);
  const originalDepth = requestedDepth;
  const originalPagesLimit = requestedPagesLimit ?? limits.crawl_pages_limit;
  
  // Cap depth to plan limit
  const maxDepth = Math.min(requestedDepth, limits.crawl_max_depth);
  
  // Cap pages limit to plan limit
  const pagesLimit = Math.min(originalPagesLimit, limits.crawl_pages_limit);
  
  const gated = maxDepth < requestedDepth || pagesLimit < originalPagesLimit;
  
  return {
    maxDepth,
    pagesLimit,
    gated,
    originalDepth,
    originalPagesLimit,
  };
}
