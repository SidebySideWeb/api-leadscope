// -----------------------------------------------------------------------------
// Export tiers (column entitlements)
// -----------------------------------------------------------------------------

export type ExportTier = 'starter' | 'pro' | 'agency';

export interface TierEntitlements {
  tier: ExportTier;
  // Column keys to include in the export rows
  columns: string[];
}

export function parseTier(input: string): ExportTier {
  const value = input.toLowerCase();
  if (value === 'starter' || value === 'pro' || value === 'agency') {
    return value;
  }
  throw new Error(
    `Invalid tier "${input}". Expected one of: starter, pro, agency.`
  );
}

export function parseFormat(input: string): 'csv' | 'xlsx' {
  const value = input.toLowerCase();
  if (value === 'csv' || value === 'xlsx') {
    return value;
  }
  throw new Error(`Invalid format "${input}". Expected one of: csv, xlsx.`);
}

export function getTierEntitlements(tier: ExportTier): TierEntitlements {
  switch (tier) {
    case 'starter':
      return {
        tier,
        columns: [
          'business_name',
          'industry',
          'city',
          'website',
          'best_email',
          'best_phone'
        ]
      };
    case 'pro':
      return {
        tier,
        columns: [
          'business_name',
          'industry',
          'city',
          'website',
          'best_email',
          'best_phone',
          'all_emails',
          'all_phones',
          'social_links',
          'contact_page_url',
          'has_contact_form',
          'last_crawled_at'
        ]
      };
    case 'agency':
      return {
        tier,
        columns: [
          'business_name',
          'industry',
          'city',
          'website',
          'best_email',
          'best_phone',
          'all_emails',
          'all_phones',
          'social_links',
          'contact_page_url',
          'has_contact_form',
          'last_crawled_at',
          'contact_confidence',
          'contact_sources',
          'pages_crawled',
          'dataset_watermark'
        ]
      };
    default: {
      throw new Error(`Unsupported export tier: ${tier as string}`);
    }
  }
}

// -----------------------------------------------------------------------------
// Plan-level pricing entitlements
// -----------------------------------------------------------------------------

export type PlanId = 'free' | 'starter' | 'pro' | 'agency';

export interface PlanEntitlements {
  id: PlanId;
  maxBusinessesPerDataset: number;
  maxPagesPerSite: number;
  exportsPerMonth: number;
  allowedExportTiers: ExportTier[];
  includeSourceUrls: boolean;
}

export const PLAN_ENTITLEMENTS: Record<PlanId, PlanEntitlements> = {
  free: {
    id: 'free',
    maxBusinessesPerDataset: 50,
    maxPagesPerSite: 5,
    exportsPerMonth: 1,
    allowedExportTiers: ['starter'],
    includeSourceUrls: false
  },
  starter: {
    id: 'starter',
    maxBusinessesPerDataset: 500,
    maxPagesPerSite: 15,
    exportsPerMonth: 5,
    allowedExportTiers: ['starter'],
    includeSourceUrls: false
  },
  pro: {
    id: 'pro',
    maxBusinessesPerDataset: 5000,
    maxPagesPerSite: 25,
    exportsPerMonth: 20,
    allowedExportTiers: ['starter', 'pro'],
    includeSourceUrls: true
  },
  agency: {
    id: 'agency',
    maxBusinessesPerDataset: 50000,
    maxPagesPerSite: 50,
    exportsPerMonth: 100,
    allowedExportTiers: ['starter', 'pro', 'agency'],
    includeSourceUrls: true
  }
};

export function getPlanEntitlements(plan: PlanId): PlanEntitlements {
  return PLAN_ENTITLEMENTS[plan];
}

// -----------------------------------------------------------------------------
// Assertion helpers – throw clear errors when limits are exceeded
// -----------------------------------------------------------------------------

export function assertCanCrawl(plan: PlanId, pagesRequested: number): void {
  const entitlements = getPlanEntitlements(plan);

  if (!Number.isFinite(pagesRequested) || pagesRequested <= 0) {
    throw new Error('pagesRequested must be a positive integer.');
  }

  if (pagesRequested > entitlements.maxPagesPerSite) {
    throw new Error(
      `Plan "${plan}" allows up to ${entitlements.maxPagesPerSite} pages per site ` +
        `(requested ${pagesRequested}). Consider upgrading your plan.`
    );
  }
}

export function assertCanExport(plan: PlanId, exportTier: ExportTier): void {
  const entitlements = getPlanEntitlements(plan);

  if (!entitlements.allowedExportTiers.includes(exportTier)) {
    const allowed = entitlements.allowedExportTiers.join(', ');
    throw new Error(
      `Export tier "${exportTier}" is not available on plan "${plan}". ` +
        `Allowed tiers: ${allowed}.`
    );
  }
}

export function assertDatasetLimit(
  plan: PlanId,
  businessCount: number
): void {
  const entitlements = getPlanEntitlements(plan);

  if (!Number.isFinite(businessCount) || businessCount < 0) {
    throw new Error('businessCount must be a non-negative integer.');
  }

  if (businessCount > entitlements.maxBusinessesPerDataset) {
    throw new Error(
      `Plan "${plan}" allows up to ${entitlements.maxBusinessesPerDataset} businesses per dataset ` +
        `(current count ${businessCount}). Consider upgrading your plan.`
    );
  }
}

