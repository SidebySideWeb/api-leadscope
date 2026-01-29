import { runRefreshJob } from '../services/refreshService.js';
import type { RefreshJobInput } from '../types/jobs.js';

/**
 * Refresh Job Handler
 * For recurring, subscription-based refreshes
 */
export async function executeRefreshJob(input: RefreshJobInput = {}) {
  return runRefreshJob(input);
}
