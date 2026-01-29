/**
 * Persistence Layer - Unified Interface
 * 
 * Exposes:
 * - getUser()
 * - getDataset()
 * - saveExport()
 * - incrementUsage()
 * 
 * Automatically falls back to local JSON files if database is unavailable.
 * Workers don't need to know where data comes from.
 */

import { resolvePersistence } from './resolver.js';

// Re-export resolvePersistence for legacy code
export { resolvePersistence };
import { logUsageIncrementAction } from '../utils/actionLogger.js';
import type { PersistenceLayer, User } from './persistence.js';
import type { Dataset } from '../db/datasets.js';
import type { ExportRecord } from '../db/exports.js';
import type { UsageTracking } from '../db/usageTracking.js';

/**
 * Get user by ID
 * Works with database or local JSON files
 */
export async function getUser(userId: string): Promise<User | null> {
  const persistence = await resolvePersistence();
  return persistence.getUser(userId);
}

/**
 * Get dataset by ID
 * Works with database or local JSON files
 */
export async function getDataset(datasetId: string): Promise<Dataset | null> {
  const persistence = await resolvePersistence();
  return persistence.getDataset(datasetId);
}

/**
 * Save export record
 * Works with database or local JSON files
 */
export async function saveExport(data: {
  datasetId: string;
  userId: string;
  tier: string;
  format: 'csv' | 'xlsx';
  rowCount: number;
  filePath: string;
  watermarkText: string;
}): Promise<ExportRecord> {
  const persistence = await resolvePersistence();
  return persistence.saveExport(data);
}

/**
 * Increment usage counter
 * Works with database or local JSON files
 */
export async function incrementUsage(
  userId: string,
  type: 'export' | 'crawl' | 'dataset'
): Promise<UsageTracking> {
  const persistence = await resolvePersistence();
  const result = await persistence.incrementUsage(userId, type);
  
  // Log usage increment action
  logUsageIncrementAction({
    userId,
    actionType: type,
    resultSummary: `Usage incremented: ${type} count is now ${type === 'export' ? result.exports_this_month : type === 'crawl' ? result.crawls_this_month : result.datasets_created_this_month} for month ${result.month_year}`,
    metadata: {
      month_year: result.month_year,
      exports_this_month: result.exports_this_month,
      crawls_this_month: result.crawls_this_month,
      datasets_created_this_month: result.datasets_created_this_month,
    },
  });
  
  return result;
}

/**
 * Get current usage for a user
 * Works with database or local JSON files
 */
export async function getUserUsage(userId: string): Promise<UsageTracking> {
  const persistence = await resolvePersistence();
  return persistence.getUserUsage(userId);
}
