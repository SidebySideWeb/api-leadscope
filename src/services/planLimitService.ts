/**
 * Plan Limit Service
 * 
 * Checks plan-based limits:
 * - Dataset count limits
 * - Dataset size limits
 * - Crawl limits
 * - Export limits
 */

import { pool } from '../config/database.js';
import { getUserPermissions } from '../db/permissions.js';
import { getUserUsage } from '../db/usageTracking.js';
import { getPlanLimits } from '../config/planLimits.js';
import { isInternalUser } from '../db/subscriptions.js';

/**
 * Check if user can create another dataset
 */
export async function canCreateDataset(userId: string): Promise<boolean> {
  const isInternal = await isInternalUser(userId);
  if (isInternal) {
    return true;
  }

  const permissions = await getUserPermissions(userId);
  const planLimits = getPlanLimits(permissions.plan);

  if (planLimits.datasets === Number.MAX_SAFE_INTEGER) {
    return true; // Unlimited
  }

  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM datasets
     WHERE user_id = $1`,
    [userId]
  );

  const currentCount = parseInt(result.rows[0]?.count || '0', 10);
  return currentCount < planLimits.datasets;
}

/**
 * Assert user can create another dataset
 * Throws error if limit reached
 */
export async function assertCanCreateDataset(userId: string): Promise<void> {
  const canCreate = await canCreateDataset(userId);
  if (!canCreate) {
    const permissions = await getUserPermissions(userId);
    const planLimits = getPlanLimits(permissions.plan);
    
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM datasets
       WHERE user_id = $1`,
      [userId]
    );
    const currentCount = parseInt(result.rows[0]?.count || '0', 10);

    const error: any = new Error(
      `Dataset limit reached: ${currentCount}/${planLimits.datasets} datasets`
    );
    error.code = 'DATASET_LIMIT_REACHED';
    error.current = currentCount;
    error.limit = planLimits.datasets;
    throw error;
  }
}

/**
 * Check if dataset can have more businesses added
 */
export async function canAddBusinessesToDataset(
  userId: string,
  datasetId: string,
  additionalBusinesses: number
): Promise<boolean> {
  const isInternal = await isInternalUser(userId);
  if (isInternal) {
    return true;
  }

  const permissions = await getUserPermissions(userId);
  const planLimits = getPlanLimits(permissions.plan);

  if (planLimits.businessesPerDataset === 'unlimited') {
    return true;
  }

  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM dataset_businesses
     WHERE dataset_id = $1`,
    [datasetId]
  );

  const currentCount = parseInt(result.rows[0]?.count || '0', 10);
  const limit = planLimits.businessesPerDataset as number;
  return (currentCount + additionalBusinesses) <= limit;
}

/**
 * Assert dataset can have more businesses added
 * Throws error if limit reached
 */
export async function assertCanAddBusinessesToDataset(
  userId: string,
  datasetId: string,
  additionalBusinesses: number
): Promise<void> {
  const canAdd = await canAddBusinessesToDataset(userId, datasetId, additionalBusinesses);
  if (!canAdd) {
    const permissions = await getUserPermissions(userId);
    const planLimits = getPlanLimits(permissions.plan);

    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM dataset_businesses
       WHERE dataset_id = $1`,
      [datasetId]
    );
    const currentCount = parseInt(result.rows[0]?.count || '0', 10);
    const limit = planLimits.businessesPerDataset as number;

    const error: any = new Error(
      `Dataset size limit reached: ${currentCount}/${limit} businesses (trying to add ${additionalBusinesses})`
    );
    error.code = 'DATASET_SIZE_LIMIT_REACHED';
    error.current = currentCount;
    error.limit = limit;
    error.additional = additionalBusinesses;
    throw error;
  }
}

/**
 * Check if user can run another crawl/discovery
 */
export async function canRunCrawl(userId: string): Promise<boolean> {
  const isInternal = await isInternalUser(userId);
  if (isInternal) {
    return true;
  }

  const permissions = await getUserPermissions(userId);
  const planLimits = getPlanLimits(permissions.plan);

  if (planLimits.crawls === Number.MAX_SAFE_INTEGER) {
    return true; // Unlimited
  }

  const usage = await getUserUsage(userId);
  return usage.crawls_this_month < planLimits.crawls;
}

/**
 * Assert user can run another crawl/discovery
 * Throws error if limit reached
 */
export async function assertCanRunCrawl(userId: string): Promise<void> {
  const canRun = await canRunCrawl(userId);
  if (!canRun) {
    const permissions = await getUserPermissions(userId);
    const planLimits = getPlanLimits(permissions.plan);
    const usage = await getUserUsage(userId);

    const error: any = new Error(
      `Crawl limit reached: ${usage.crawls_this_month}/${planLimits.crawls} crawls this month`
    );
    error.code = 'CRAWL_LIMIT_REACHED';
    error.current = usage.crawls_this_month;
    error.limit = planLimits.crawls;
    throw error;
  }
}

/**
 * Check if user can run another export
 */
export async function canRunExport(userId: string): Promise<boolean> {
  const isInternal = await isInternalUser(userId);
  if (isInternal) {
    return true;
  }

  const permissions = await getUserPermissions(userId);
  const planLimits = getPlanLimits(permissions.plan);

  if (planLimits.exports === Number.MAX_SAFE_INTEGER) {
    return true; // Unlimited
  }

  const usage = await getUserUsage(userId);
  return usage.exports_this_month < planLimits.exports;
}

/**
 * Assert user can run another export
 * Throws error if limit reached
 */
export async function assertCanRunExport(userId: string): Promise<void> {
  const canRun = await canRunExport(userId);
  if (!canRun) {
    const permissions = await getUserPermissions(userId);
    const planLimits = getPlanLimits(permissions.plan);
    const usage = await getUserUsage(userId);

    const error: any = new Error(
      `Export limit reached: ${usage.exports_this_month}/${planLimits.exports} exports this month`
    );
    error.code = 'EXPORT_LIMIT_REACHED';
    error.current = usage.exports_this_month;
    error.limit = planLimits.exports;
    throw error;
  }
}

/**
 * Get current monthly usage for a user
 */
export async function getCurrentMonthlyUsage(userId: string): Promise<{
  crawls: number;
  exports: number;
  datasets: number;
}> {
  const usage = await getUserUsage(userId);
  return {
    crawls: usage.crawls_this_month || 0,
    exports: usage.exports_this_month || 0,
    datasets: usage.datasets_created_this_month || 0,
  };
}

/**
 * Get effective plan limits for a user (bypasses limits for internal users)
 */
export async function getEffectivePlanLimits(userId: string): Promise<{
  credits: number;
  crawls: number;
  exports: number;
  datasets: number;
  businessesPerDataset: number;
}> {
  const isInternal = await isInternalUser(userId);
  if (isInternal) {
    return {
      credits: Number.MAX_SAFE_INTEGER,
      crawls: Number.MAX_SAFE_INTEGER,
      exports: Number.MAX_SAFE_INTEGER,
      datasets: Number.MAX_SAFE_INTEGER,
      businessesPerDataset: Number.MAX_SAFE_INTEGER,
    };
  }

  const permissions = await getUserPermissions(userId);
  const planLimits = getPlanLimits(permissions.plan);
  
  return {
    credits: planLimits.credits === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : planLimits.credits,
    crawls: planLimits.crawls === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : planLimits.crawls,
    exports: planLimits.exports === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : planLimits.exports,
    datasets: planLimits.datasets === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : planLimits.datasets,
    businessesPerDataset: planLimits.businessesPerDataset === 'unlimited' || planLimits.businessesPerDataset === Number.MAX_SAFE_INTEGER 
      ? Number.MAX_SAFE_INTEGER 
      : planLimits.businessesPerDataset as number,
  };
}

/**
 * Get current number of businesses in a dataset
 */
export async function getDatasetBusinessCount(datasetId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM businesses
     WHERE dataset_id = $1`,
    [datasetId]
  );
  return parseInt(result.rows[0]?.count || '0', 10);
}
