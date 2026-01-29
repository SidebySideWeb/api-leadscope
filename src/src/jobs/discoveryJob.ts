import { runDiscoveryJob } from '../services/discoveryService.js';
import type { DiscoveryJobInput } from '../types/jobs.js';

/**
 * Discovery Job Handler
 * For ad-hoc, paid discovery requests
 */
export async function executeDiscoveryJob(input: DiscoveryJobInput) {
  return runDiscoveryJob(input);
}
