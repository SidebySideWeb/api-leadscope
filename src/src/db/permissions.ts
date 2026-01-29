/**
 * Backend Permission Resolver
 * 
 * Source of truth: Stripe subscription state (database)
 * Never trusts client payload
 * 
 * Returns user permissions based on their plan from Stripe subscription.
 */

import { getUserPlan } from './userPlans.js';
import { pool } from '../config/database.js';
import type { PlanId } from '../types/plan.js';

export type Plan = PlanId; // Alias for backward compatibility

export interface UserPermissions {
  plan: Plan;
  max_export_rows: number;
  max_crawl_pages: number; // Max depth for crawling
  max_datasets: number;
  can_refresh: boolean;
  is_internal_user: boolean; // If true, bypasses all plan limits
}

/**
 * Plan-specific permission configuration
 */
const PLAN_PERMISSIONS: Record<Plan, Omit<UserPermissions, 'plan'>> = {
  demo: {
    max_export_rows: 50,
    max_crawl_pages: 1, // Depth 1 only
    max_datasets: 1,
    can_refresh: false, // No refresh for demo
    is_internal_user: false, // Not internal by default
  },
  starter: {
    max_export_rows: 1000,
    max_crawl_pages: 3, // Depth 3
    max_datasets: 5,
    can_refresh: true, // Monthly refresh allowed
    is_internal_user: false, // Not internal by default
  },
  pro: {
    max_export_rows: Number.MAX_SAFE_INTEGER, // Unlimited
    max_crawl_pages: 10, // Depth 10
    max_datasets: Number.MAX_SAFE_INTEGER, // Unlimited
    can_refresh: true, // Monthly refresh allowed
    is_internal_user: false, // Not internal by default
  },
};

/**
 * Get user permissions from Stripe subscription state
 * 
 * Source of truth: subscriptions table (populated by Stripe webhooks)
 * Never trusts client payload - always queries database
 * 
 * @param userId - User UUID
 * @returns User permissions based on their plan
 */
export async function getUserPermissions(userId: string): Promise<UserPermissions> {
  try {
    // Check if user is internal (bypasses all limits)
    const { isInternalUser } = await import('./subscriptions.js');
    const isInternal = await isInternalUser(userId);
    
    // Get user plan from database (source of truth: Stripe webhook)
    const plan = await getUserPlan(userId);
    
    // Get permissions for the plan
    const permissions = PLAN_PERMISSIONS[plan];
    
    // If internal user, set unlimited permissions
    if (isInternal) {
      return {
        plan,
        max_export_rows: Number.MAX_SAFE_INTEGER, // Unlimited
        max_crawl_pages: 10, // Max safety limit still applies
        max_datasets: Number.MAX_SAFE_INTEGER, // Unlimited
        can_refresh: true, // Can refresh
        is_internal_user: true,
      };
    }
    
    return {
      plan,
      ...permissions,
      is_internal_user: false,
    };
  } catch (error) {
    // If database query fails, default to demo plan
    console.error('[getUserPermissions] Error getting user plan, defaulting to demo:', error);
    return {
      plan: 'demo',
      ...PLAN_PERMISSIONS.demo,
      is_internal_user: false,
    };
  }
}

/**
 * Verify user has permission for an action
 * 
 * @param userId - User UUID
 * @param action - Action to check permission for
 * @param value - Value to check against limit (optional)
 * @returns Permission check result
 */
export async function checkPermission(
  userId: string,
  action: 'export' | 'crawl' | 'dataset' | 'refresh',
  value?: number
): Promise<{
  allowed: boolean;
  permissions: UserPermissions;
  reason?: string;
  upgrade_hint?: string;
}> {
  const permissions = await getUserPermissions(userId);
  
  switch (action) {
    case 'export':
      if (value !== undefined && value > permissions.max_export_rows) {
        return {
          allowed: false,
          permissions,
          reason: `${permissions.plan === 'demo' ? 'Demo' : permissions.plan === 'starter' ? 'Starter' : 'Pro'} plan allows up to ${permissions.max_export_rows} rows per export. Requested ${value} rows.`,
          upgrade_hint: permissions.plan === 'demo'
            ? 'Upgrade to Starter plan for up to 1,000 rows per export.'
            : permissions.plan === 'starter'
            ? 'Upgrade to Pro plan for unlimited exports.'
            : undefined,
        };
      }
      break;
      
    case 'crawl':
      if (value !== undefined && value > permissions.max_crawl_pages) {
        return {
          allowed: false,
          permissions,
          reason: `${permissions.plan === 'demo' ? 'Demo' : permissions.plan === 'starter' ? 'Starter' : 'Pro'} plan allows crawl depth up to ${permissions.max_crawl_pages}. Requested depth ${value}.`,
          upgrade_hint: permissions.plan === 'demo'
            ? 'Upgrade to Starter plan for crawl depth up to 3.'
            : permissions.plan === 'starter'
            ? 'Upgrade to Pro plan for crawl depth up to 10.'
            : undefined,
        };
      }
      break;
      
    case 'dataset':
      // This would need current dataset count, handled separately
      break;
      
    case 'refresh':
      if (!permissions.can_refresh) {
        return {
          allowed: false,
          permissions,
          reason: 'Demo plan does not allow dataset refresh.',
          upgrade_hint: 'Upgrade to Starter or Pro plan for monthly dataset refresh.',
        };
      }
      break;
  }
  
  return {
    allowed: true,
    permissions,
  };
}

/**
 * Get user plan directly (convenience function)
 * 
 * @param userId - User UUID
 * @returns User's plan
 */
export async function getUserPlanFromPermissions(userId: string): Promise<Plan> {
  const permissions = await getUserPermissions(userId);
  return permissions.plan;
}
