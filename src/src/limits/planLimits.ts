export interface PlanLimits {
  snapshotExportsPerIndustryCity: number;
  subscriptionExportsPerMonth: number;
  subscriptionRowsPerMonth: number;
  adminExportsPerMonth: number;
  adminRowsPerMonth: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    snapshotExportsPerIndustryCity: 0,
    subscriptionExportsPerMonth: 0,
    subscriptionRowsPerMonth: 0,
    adminExportsPerMonth: 0,
    adminRowsPerMonth: 0
  },
  basic: {
    snapshotExportsPerIndustryCity: 1,
    subscriptionExportsPerMonth: 1,
    subscriptionRowsPerMonth: 1000,
    adminExportsPerMonth: 0,
    adminRowsPerMonth: 0
  },
  professional: {
    snapshotExportsPerIndustryCity: 1,
    subscriptionExportsPerMonth: 3,
    subscriptionRowsPerMonth: 5000,
    adminExportsPerMonth: 0,
    adminRowsPerMonth: 0
  },
  enterprise: {
    snapshotExportsPerIndustryCity: 1,
    subscriptionExportsPerMonth: 10,
    subscriptionRowsPerMonth: 50000,
    adminExportsPerMonth: 0,
    adminRowsPerMonth: 0
  },
  admin: {
    snapshotExportsPerIndustryCity: 999999,
    subscriptionExportsPerMonth: 999999,
    subscriptionRowsPerMonth: 999999999,
    adminExportsPerMonth: 999999,
    adminRowsPerMonth: 999999999
  }
};

/**
 * Get user's plan limits
 * In production, this would query a users/subscriptions table
 */
export function getUserPlanLimits(_userId: string, planName: string = 'basic'): PlanLimits {
  return PLAN_LIMITS[planName] || PLAN_LIMITS.basic;
}

/**
 * Check if user can perform snapshot export
 */
export async function canExportSnapshot(
  userId: string,
  industryId: number,
  cityId: number,
  planName: string = 'basic'
): Promise<{ allowed: boolean; reason?: string }> {
  const limits = getUserPlanLimits(userId, planName);
  
  if (limits.snapshotExportsPerIndustryCity === 0) {
    return { allowed: false, reason: 'Snapshot exports not available on your plan' };
  }

  // Check if user already exported this industry+city combination
  const { pool } = await import('../config/database.js');
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM exports
     WHERE user_id = $1
       AND export_type = 'snapshot'
       AND industry_id = $1
       AND city_id = $2`,
    [userId, industryId, cityId]
  );

  const existingExports = parseInt(result.rows[0]?.count || '0', 10);
  
  if (existingExports >= limits.snapshotExportsPerIndustryCity) {
    return {
      allowed: false,
      reason: `You have already exported this industry+city combination. Snapshot exports are frozen forever.`
    };
  }

  return { allowed: true };
}

/**
 * Check if user can perform subscription export
 */
export async function canExportSubscription(
  userId: string,
  requestedRows: number,
  planName: string = 'basic'
): Promise<{ allowed: boolean; reason?: string; remainingRows?: number }> {
  const limits = getUserPlanLimits(userId, planName);
  
  if (limits.subscriptionExportsPerMonth === 0) {
    return { allowed: false, reason: 'Subscription exports not available on your plan' };
  }

  // Get current month's export usage
  const { pool } = await import('../config/database.js');
  const exportsResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM exports
     WHERE user_id = $1
       AND export_type = 'subscription'
       AND created_at >= date_trunc('month', CURRENT_DATE)`,
    [userId]
  );

  const exportsThisMonth = parseInt(exportsResult.rows[0]?.count || '0', 10);
  
  if (exportsThisMonth >= limits.subscriptionExportsPerMonth) {
    return {
      allowed: false,
      reason: `Monthly export limit reached (${limits.subscriptionExportsPerMonth} exports)`
    };
  }

  // Get current month's row usage
  const rowsResult = await pool.query<{ sum: string }>(
    `SELECT COALESCE(SUM(total_rows), 0) as sum
     FROM exports
     WHERE user_id = $1
       AND export_type = 'subscription'
       AND created_at >= date_trunc('month', CURRENT_DATE)`,
    [userId]
  );

  const rowsUsedThisMonth = parseInt(rowsResult.rows[0]?.sum || '0', 10);
  const remainingRows = limits.subscriptionRowsPerMonth - rowsUsedThisMonth;

  if (requestedRows > remainingRows) {
    return {
      allowed: false,
      reason: `Insufficient monthly row quota. Requested: ${requestedRows}, Remaining: ${remainingRows}`,
      remainingRows
    };
  }

  return { allowed: true, remainingRows };
}
