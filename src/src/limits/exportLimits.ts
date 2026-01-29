/**
 * Export limits based on user plan
 * Enforces server-side limits for exports
 */

export type UserPlan = 'demo' | 'paid' | 'admin';

export interface ExportLimitResult {
  allowed: boolean;
  maxRows: number;
  reason?: string;
}

/**
 * Get export limits for a user plan
 */
export function getExportLimits(plan: UserPlan): ExportLimitResult {
  switch (plan) {
    case 'demo':
      return {
        allowed: true,
        maxRows: 50,
        reason: 'Demo plan limited to 50 rows per export'
      };
    case 'paid':
      return {
        allowed: true,
        maxRows: Number.MAX_SAFE_INTEGER, // Unlimited
        reason: undefined
      };
    case 'admin':
      return {
        allowed: true,
        maxRows: Number.MAX_SAFE_INTEGER, // Unlimited
        reason: undefined
      };
    default:
      return {
        allowed: false,
        maxRows: 0,
        reason: `Unknown plan: ${plan}`
      };
  }
}

/**
 * Check if export is allowed and enforce row limit
 */
export function enforceExportLimit(
  plan: UserPlan,
  requestedRows?: number
): ExportLimitResult {
  const limits = getExportLimits(plan);

  if (!limits.allowed) {
    return limits;
  }

  if (requestedRows !== undefined && requestedRows > limits.maxRows) {
    return {
      allowed: false,
      maxRows: limits.maxRows,
      reason: `Requested ${requestedRows} rows, but ${plan} plan allows maximum ${limits.maxRows} rows`
    };
  }

  return {
    allowed: true,
    maxRows: limits.maxRows,
    reason: requestedRows ? undefined : limits.reason
  };
}

/**
 * Get user plan (in a real app, this would query the database)
 * For now, we'll use a simple mapping or environment variable
 */
export async function getUserPlan(_userId: string): Promise<UserPlan> {
  // In a real implementation, this would query the database
  // For now, we'll check an environment variable or use a default
  const planEnv = process.env.USER_PLAN || 'demo';
  
  if (planEnv === 'paid' || planEnv === 'admin') {
    return planEnv;
  }
  
  return 'demo';
}
