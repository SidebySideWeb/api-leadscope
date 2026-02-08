/**
 * Plan Limits Configuration
 * 
 * Defines limits for each subscription plan:
 * - Credits: Starting credits per month
 * - Crawls: Max discovery runs per month
 * - Exports: Max exports per month
 * - Datasets: Max datasets user can have
 * - BusinessesPerDataset: Max businesses per dataset
 */

export interface PlanLimits {
  credits: number;
  crawls: number;
  exports: number;
  datasets: number;
  businessesPerDataset: number | 'unlimited';
}

export const PLAN_LIMITS: Record<'demo' | 'starter' | 'pro', PlanLimits> = {
  demo: {
    credits: 50,
    crawls: 1,
    exports: 1,
    datasets: 1,
    businessesPerDataset: 50,
  },
  starter: {
    credits: 500,
    crawls: 10,
    exports: 10,
    datasets: 5,
    businessesPerDataset: 2000,
  },
  pro: {
    credits: 3000,
    crawls: 100,
    exports: 50,
    datasets: 20,
    businessesPerDataset: 'unlimited',
  },
};

/**
 * Get plan limits for a plan
 */
export function getPlanLimits(plan: 'demo' | 'starter' | 'pro'): PlanLimits {
  return PLAN_LIMITS[plan];
}
