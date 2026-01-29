/**
 * Usage Tracking Database Module
 * 
 * Tracks monthly usage per user:
 * - exports_this_month
 * - crawls_this_month
 * - datasets_created_this_month
 * 
 * Automatically resets at the start of each month.
 */

import { pool } from '../config/database.js';

export interface UsageTracking {
  id: string;
  user_id: string;
  month_year: string; // Format: 'YYYY-MM'
  exports_this_month: number;
  crawls_this_month: number;
  datasets_created_this_month: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Get current month-year string (YYYY-MM)
 */
function getCurrentMonthYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Ensure usage record exists for current month
 * Creates new record if it doesn't exist (automatic monthly reset)
 */
async function ensureUsageRecord(userId: string): Promise<UsageTracking> {
  const monthYear = getCurrentMonthYear();
  
  // Try to get existing record
  const existing = await pool.query<UsageTracking>(
    `SELECT * FROM usage_tracking
     WHERE user_id = $1 AND month_year = $2`,
    [userId, monthYear]
  );
  
  if (existing.rows[0]) {
    return existing.rows[0];
  }
  
  // Create new record for this month (automatic reset)
  const result = await pool.query<UsageTracking>(
    `INSERT INTO usage_tracking (user_id, month_year)
     VALUES ($1, $2)
     RETURNING *`,
    [userId, monthYear]
  );
  
  return result.rows[0];
}

/**
 * Get current usage for a user
 */
export async function getUserUsage(userId: string): Promise<UsageTracking> {
  return ensureUsageRecord(userId);
}

/**
 * Increment export count for a user
 */
export async function incrementExports(userId: string): Promise<UsageTracking> {
  await ensureUsageRecord(userId);
  const monthYear = getCurrentMonthYear();
  
  const result = await pool.query<UsageTracking>(
    `UPDATE usage_tracking
     SET exports_this_month = exports_this_month + 1,
         updated_at = NOW()
     WHERE user_id = $1 AND month_year = $2
     RETURNING *`,
    [userId, monthYear]
  );
  
  return result.rows[0];
}

/**
 * Increment crawl count for a user
 */
export async function incrementCrawls(userId: string): Promise<UsageTracking> {
  await ensureUsageRecord(userId);
  const monthYear = getCurrentMonthYear();
  
  const result = await pool.query<UsageTracking>(
    `UPDATE usage_tracking
     SET crawls_this_month = crawls_this_month + 1,
         updated_at = NOW()
     WHERE user_id = $1 AND month_year = $2
     RETURNING *`,
    [userId, monthYear]
  );
  
  return result.rows[0];
}

/**
 * Increment dataset creation count for a user
 */
export async function incrementDatasets(userId: string): Promise<UsageTracking> {
  await ensureUsageRecord(userId);
  const monthYear = getCurrentMonthYear();
  
  const result = await pool.query<UsageTracking>(
    `UPDATE usage_tracking
     SET datasets_created_this_month = datasets_created_this_month + 1,
         updated_at = NOW()
     WHERE user_id = $1 AND month_year = $2
     RETURNING *`,
    [userId, monthYear]
  );
  
  return result.rows[0];
}

/**
 * Get usage statistics for a user
 */
export async function getUsageStats(userId: string): Promise<{
  exports_this_month: number;
  crawls_this_month: number;
  datasets_created_this_month: number;
  month_year: string;
}> {
  const usage = await getUserUsage(userId);
  return {
    exports_this_month: usage.exports_this_month,
    crawls_this_month: usage.crawls_this_month,
    datasets_created_this_month: usage.datasets_created_this_month,
    month_year: usage.month_year,
  };
}
