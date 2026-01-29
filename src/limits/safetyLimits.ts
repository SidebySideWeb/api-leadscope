/**
 * Global Safety Limits
 * 
 * Hard limits that cannot be overridden by plan tiers.
 * These are safety caps to prevent resource exhaustion and abuse.
 */

/**
 * Maximum pages per crawl (hard limit)
 * Cannot be exceeded regardless of plan
 */
export const MAX_PAGES_PER_CRAWL = 50;

/**
 * Maximum concurrent crawls (hard limit)
 * Only one crawl can run at a time
 */
export const MAX_CONCURRENT_CRAWLS = 1;

/**
 * Crawl timeout in milliseconds (hard limit)
 * Maximum time allowed for a single crawl operation
 */
export const CRAWL_TIMEOUT_MS = 60000; // 60 seconds

/**
 * Check if pages requested exceeds safety limit
 */
export function checkPagesLimit(requestedPages: number): {
  allowed: boolean;
  actual: number;
  reason?: string;
} {
  if (requestedPages > MAX_PAGES_PER_CRAWL) {
    return {
      allowed: false,
      actual: MAX_PAGES_PER_CRAWL,
      reason: `Safety limit: Maximum ${MAX_PAGES_PER_CRAWL} pages per crawl (requested: ${requestedPages})`,
    };
  }

  return {
    allowed: true,
    actual: requestedPages,
  };
}

/**
 * Check if timeout requested exceeds safety limit
 */
export function checkTimeoutLimit(requestedTimeoutMs: number): {
  allowed: boolean;
  actual: number;
  reason?: string;
} {
  if (requestedTimeoutMs > CRAWL_TIMEOUT_MS) {
    return {
      allowed: false,
      actual: CRAWL_TIMEOUT_MS,
      reason: `Safety limit: Maximum ${CRAWL_TIMEOUT_MS}ms timeout per crawl (requested: ${requestedTimeoutMs}ms)`,
    };
  }

  return {
    allowed: true,
    actual: requestedTimeoutMs,
  };
}

/**
 * Apply safety caps to crawl parameters
 * Returns the actual values to use (capped at safety limits)
 */
export function applySafetyCaps(params: {
  maxPages?: number;
  timeoutMs?: number;
}): {
  maxPages: number;
  timeoutMs: number;
} {
  const pagesCheck = checkPagesLimit(params.maxPages ?? MAX_PAGES_PER_CRAWL);
  const timeoutCheck = checkTimeoutLimit(params.timeoutMs ?? CRAWL_TIMEOUT_MS);

  return {
    maxPages: pagesCheck.actual,
    timeoutMs: timeoutCheck.actual,
  };
}
