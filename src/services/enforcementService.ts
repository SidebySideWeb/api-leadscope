/**
 * Enforcement Service
 * 
 * Centralized enforcement for all operations:
 * - Discovery runs
 * - Exports
 * - Dataset creation
 * - Dataset size
 * 
 * Combines plan limits and credit checks
 */

import { assertCanRunCrawl, assertCanCreateDataset, assertCanAddBusinessesToDataset, assertCanRunExport } from './planLimitService.js';
import { assertCreditsAvailable } from './creditService.js';
import { calculateDiscoveryCost, calculateExportCost } from '../config/creditCostConfig.js';
import { isInternalUser } from '../db/subscriptions.js';

/**
 * Enforce limits before starting discovery run
 */
export async function enforceDiscoveryRun(
  userId: string,
  estimatedBusinesses: number
): Promise<void> {
  const isInternal = await isInternalUser(userId);
  if (isInternal) {
    return; // Internal users bypass all enforcement
  }

  // Check crawl limit
  await assertCanRunCrawl(userId);

  // Check credit cost
  const creditCost = calculateDiscoveryCost(estimatedBusinesses);
  await assertCreditsAvailable(userId, creditCost);
}

/**
 * Enforce limits before export
 */
export async function enforceExport(
  userId: string,
  estimatedRows: number
): Promise<void> {
  const isInternal = await isInternalUser(userId);
  if (isInternal) {
    return; // Internal users bypass all enforcement
  }

  // Check export limit
  await assertCanRunExport(userId);

  // Check credit cost
  const creditCost = calculateExportCost(estimatedRows);
  await assertCreditsAvailable(userId, creditCost);
}

/**
 * Enforce limits before dataset creation
 */
export async function enforceDatasetCreation(userId: string): Promise<void> {
  const isInternal = await isInternalUser(userId);
  if (isInternal) {
    return; // Internal users bypass all enforcement
  }

  await assertCanCreateDataset(userId);
}

/**
 * Enforce limits before adding businesses to dataset
 */
export async function enforceDatasetSize(
  userId: string,
  datasetId: string,
  additionalBusinesses: number
): Promise<void> {
  const isInternal = await isInternalUser(userId);
  if (isInternal) {
    return; // Internal users bypass all enforcement
  }

  await assertCanAddBusinessesToDataset(userId, datasetId, additionalBusinesses);
}
