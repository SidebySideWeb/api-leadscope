/**
 * Credit Cost Configuration
 * 
 * Defines credit costs for different operations:
 * - discoveryBusiness: Cost per business discovered
 * - websiteCrawl: Cost per website crawled
 * - emailExtraction: Cost per email extracted
 * - exportRow: Cost per row exported
 */

export interface CreditCosts {
  discoveryBusiness: number;
  websiteCrawl: number;
  emailExtraction: number;
  exportRow: number;
}

export const CREDIT_COSTS: CreditCosts = {
  discoveryBusiness: 0.2,
  websiteCrawl: 1,
  emailExtraction: 2,
  exportRow: 0.05, // 0.05 euros per row (1 credit = 1 euro)
};

/**
 * Calculate credit cost for discovery run
 */
export function calculateDiscoveryCost(businessesFound: number): number {
  return Math.ceil(businessesFound * CREDIT_COSTS.discoveryBusiness);
}

/**
 * Calculate credit cost for website crawl
 */
export function calculateCrawlCost(websitesCrawled: number): number {
  return websitesCrawled * CREDIT_COSTS.websiteCrawl;
}

/**
 * Calculate credit cost for email extraction
 */
export function calculateEmailExtractionCost(emailsExtracted: number): number {
  return emailsExtracted * CREDIT_COSTS.emailExtraction;
}

/**
 * Calculate credit cost for export
 */
export function calculateExportCost(rowsExported: number): number {
  return Math.ceil(rowsExported * CREDIT_COSTS.exportRow);
}
