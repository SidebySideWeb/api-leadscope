/**
 * Crawl Concurrency Control
 * 
 * Ensures only MAX_CONCURRENT_CRAWLS crawls run at a time.
 * Hard limit that cannot be overridden.
 */

import { MAX_CONCURRENT_CRAWLS } from '../limits/safetyLimits.js';

let activeCrawls = 0;
const waitQueue: Array<() => void> = [];

/**
 * Acquire a crawl slot
 * Returns a promise that resolves when a slot is available
 */
export async function acquireCrawlSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    if (activeCrawls < MAX_CONCURRENT_CRAWLS) {
      activeCrawls++;
      // Return release function
      resolve(() => {
        activeCrawls--;
        // Process next in queue
        if (waitQueue.length > 0) {
          const next = waitQueue.shift()!;
          next();
        }
      });
    } else {
      // Wait in queue
      waitQueue.push(() => {
        activeCrawls++;
        resolve(() => {
          activeCrawls--;
          // Process next in queue
          if (waitQueue.length > 0) {
            const next = waitQueue.shift()!;
            next();
          }
        });
      });
    }
  });
}

/**
 * Get current active crawl count
 */
export function getActiveCrawlCount(): number {
  return activeCrawls;
}
