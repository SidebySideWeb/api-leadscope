/**
 * Pricing Gates - Usage Examples
 * 
 * This file demonstrates how to use the pricing gates in workers and API routes.
 * All limits are enforced server-side with explicit errors.
 */

import { 
  assertExport, 
  assertCrawlDepth, 
  assertCrawlCount,
  getExportLimit,
  getCrawlDepthLimit,
  getCrawlCountLimit,
  type Plan 
} from './pricing.js';

/**
 * Example: Export Worker
 * 
 * Enforces export limit before processing
 */
export async function exampleExportWorker(plan: Plan, totalRows: number) {
  try {
    // Assert export limit (throws if exceeded)
    assertExport(plan, totalRows);
    
    // If we get here, export is allowed
    const limit = getExportLimit(plan);
    const rowsToExport = Math.min(totalRows, limit);
    
    console.log(`Exporting ${rowsToExport} of ${totalRows} rows (limit: ${limit})`);
    
    // ... perform export ...
    
    return {
      success: true,
      rows_exported: rowsToExport,
      rows_total: totalRows,
      limit: limit,
    };
  } catch (error: any) {
    // Explicit error thrown by pricing gate
    console.error('Export failed:', error.message);
    throw error; // Re-throw for API to handle
  }
}

/**
 * Example: Crawl Worker
 * 
 * Enforces crawl depth limit before crawling
 */
export async function exampleCrawlWorker(plan: Plan, maxDepth: number) {
  try {
    // Assert crawl depth limit (throws if exceeded)
    assertCrawlDepth(plan, maxDepth);
    
    // If we get here, crawl depth is allowed
    const limit = getCrawlDepthLimit(plan);
    const actualDepth = Math.min(maxDepth, limit);
    
    console.log(`Crawling with depth ${actualDepth} (limit: ${limit})`);
    
    // ... perform crawl ...
    
    return {
      success: true,
      depth_used: actualDepth,
      depth_limit: limit,
    };
  } catch (error: any) {
    // Explicit error thrown by pricing gate
    console.error('Crawl failed:', error.message);
    throw error; // Re-throw for API to handle
  }
}

/**
 * Example: Crawl Count Tracking
 * 
 * Enforces total number of crawls per user
 */
export async function exampleCrawlCountCheck(plan: Plan, currentCrawlCount: number) {
  try {
    // Assert crawl count limit (throws if exceeded)
    assertCrawlCount(plan, currentCrawlCount);
    
    // If we get here, crawl count is allowed
    const limit = getCrawlCountLimit(plan);
    
    console.log(`Crawl count: ${currentCrawlCount}/${limit}`);
    
    // ... perform crawl ...
    
    return {
      success: true,
      crawl_count: currentCrawlCount,
      crawl_limit: limit,
    };
  } catch (error: any) {
    // Explicit error thrown by pricing gate
    console.error('Crawl count limit exceeded:', error.message);
    throw error; // Re-throw for API to handle
  }
}

/**
 * Example: API Route Handler
 * 
 * Enforces limits in API routes before processing requests
 */
export async function exampleApiRoute(plan: Plan, requestedRows: number) {
  try {
    // Check limits before processing
    assertExport(plan, requestedRows);
    
    // Process request
    return {
      success: true,
      message: 'Export request accepted',
    };
  } catch (error: any) {
    // Return error response to client
    return {
      success: false,
      error: error.message,
      statusCode: 403, // Forbidden
    };
  }
}

/**
 * Example: UI Helper (Read-Only)
 * 
 * UI can read limits for display, but cannot bypass
 */
export function exampleUILimits(plan: Plan) {
  // UI can only read limits, never bypass
  return {
    exportLimit: getExportLimit(plan),
    crawlDepthLimit: getCrawlDepthLimit(plan),
    crawlCountLimit: getCrawlCountLimit(plan),
  };
}
