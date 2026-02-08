/**
 * @deprecated This worker uses Google Places API and database-first hybrid approach.
 * 
 * REPLACED BY: src/discovery/vriskoDiscoveryWorker.ts
 * 
 * The new vriskoDiscoveryWorker uses ONLY vrisko.gr as the discovery source.
 * 
 * This file is kept for reference but should NOT be used in production.
 * All discovery should go through vriskoDiscoveryWorker.
 */

// This file is intentionally left mostly empty to prevent accidental usage
// The actual implementation has been moved to src/discovery/vriskoDiscoveryWorker.ts

export interface DiscoveryResult {
  businessesFound: number;
  businessesCreated: number;
  businessesSkipped: number;
  businessesUpdated: number;
  errors: string[];
  gridPointsGenerated: number;
  searchesExecuted: number;
  uniqueBusinessesDiscovered: number;
  coverageScore: number;
  stoppedEarly: boolean;
  stopReason?: string;
  estimatedBusinesses: number;
  completenessStats: {
    withWebsitePercent: number;
    withEmailPercent: number;
    withPhonePercent: number;
  };
  exportEstimates: Array<{
    size: number;
    priceEUR: number;
  }>;
  refreshEstimates: {
    incompleteOnly: {
      pricePerBusinessEUR: number;
      estimatedTotalEUR: number;
    };
    fullRefresh: {
      pricePerBusinessEUR: number;
      estimatedTotalEUR: number;
    };
  };
  extractionJobsCreated?: number;
}

/**
 * @deprecated Use discoverBusinessesVrisko from src/discovery/vriskoDiscoveryWorker.ts instead
 */
export async function discoverBusinessesV2(
  input: any,
  discoveryRunId?: string
): Promise<DiscoveryResult> {
  throw new Error(
    'discoverBusinessesV2 is deprecated. Use discoverBusinessesVrisko from src/discovery/vriskoDiscoveryWorker.ts instead. ' +
    'This function used Google Places API which has been removed from discovery.'
  );
}
