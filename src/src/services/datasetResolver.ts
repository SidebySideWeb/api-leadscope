/**
 * Dataset Resolver Service
 * 
 * Implements dataset reuse logic:
 * - If dataset exists for city + industry and last_refreshed_at < 30 days, reuse it
 * - Otherwise create new dataset
 * 
 * This is backend-only logic. UI should not care about reuse.
 */

import { getOrCreateDataset, updateDatasetRefreshTime, type Dataset } from '../db/datasets.js';
import { getOrCreateCity } from '../db/cities.js';
import { getOrCreateIndustry } from '../db/industries.js';
import { getCountryByCode } from '../db/countries.js';

const GREECE_COUNTRY_CODE = 'GR';

export interface DatasetResolverInput {
  userId: string;
  cityName: string;
  industryName: string;
  datasetName?: string;
}

export interface DatasetResolverResult {
  dataset: Dataset;
  isReused: boolean;
  shouldRefresh: boolean;
}

/**
 * Resolve dataset with reuse logic
 * 
 * Rules:
 * - If dataset exists for city + industry and last_refreshed_at < 30 days, reuse it
 * - Otherwise create new dataset
 * 
 * @param input - User ID, city name, industry name, optional dataset name
 * @returns Dataset and whether it was reused
 */
export async function resolveDataset(
  input: DatasetResolverInput
): Promise<DatasetResolverResult> {
  const { userId, cityName, industryName, datasetName } = input;

  // Get or create city
  const country = await getCountryByCode(GREECE_COUNTRY_CODE);
  if (!country) {
    throw new Error(`Country ${GREECE_COUNTRY_CODE} not found`);
  }

  const city = await getOrCreateCity(cityName, country.id);
  
  // Get or create industry
  const industry = await getOrCreateIndustry(industryName);

  // Get or create dataset (with reuse logic)
  const dataset = await getOrCreateDataset(
    userId,
    city.id,
    industry.id,
    datasetName
  );

  // Check if this is a reused dataset
  const isReused = dataset.last_refreshed_at !== null;
  
  // Determine if we should refresh (dataset is older than 30 days or new)
  const shouldRefresh = !isReused || isDatasetStale(dataset.last_refreshed_at);

  return {
    dataset,
    isReused,
    shouldRefresh,
  };
}

/**
 * Check if dataset is stale (older than 30 days)
 */
function isDatasetStale(lastRefreshedAt: Date | null): boolean {
  if (!lastRefreshedAt) {
    return true; // Never refreshed, consider stale
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return lastRefreshedAt < thirtyDaysAgo;
}

/**
 * Mark dataset as refreshed
 * Updates last_refreshed_at timestamp
 */
export async function markDatasetRefreshed(datasetId: string): Promise<void> {
  await updateDatasetRefreshTime(datasetId);
}
