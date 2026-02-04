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
import { getCityById, getCityByNormalizedName } from '../db/cities.js';
import { getIndustryById, getIndustryByName } from '../db/industries.js';
import { normalizeCityName } from '../utils/cityNormalizer.js';

export interface DatasetResolverInput {
  userId: string;
  cityId?: string; // Preferred: use city ID
  cityName?: string; // Fallback: use city name (must exist, won't create)
  industryId?: string; // Preferred: use industry ID
  industryName?: string; // Fallback: use industry name (must exist, won't create)
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
 * @param input - User ID, city ID (preferred) or city name (must exist), industry name, optional dataset name
 * @returns Dataset and whether it was reused
 */
export async function resolveDataset(
  input: DatasetResolverInput
): Promise<DatasetResolverResult> {
  const { userId, cityId, cityName, industryId, industryName, datasetName } = input;

  // Get city by ID (preferred) or by name (must exist, won't create)
  let city;
  if (cityId) {
    city = await getCityById(cityId);
    if (!city) {
      throw new Error(`City with ID ${cityId} not found`);
    }
  } else if (cityName) {
    const normalizedName = normalizeCityName(cityName);
    city = await getCityByNormalizedName(normalizedName);
    if (!city) {
      throw new Error(`City "${cityName}" not found. Please use an existing city ID.`);
    }
  } else {
    throw new Error('Either cityId or cityName is required');
  }
  
  // Get industry by ID (preferred) or by name (must exist, won't create)
  let industry;
  if (industryId) {
    industry = await getIndustryById(industryId);
    if (!industry) {
      throw new Error(`Industry with ID ${industryId} not found`);
    }
  } else if (industryName) {
    industry = await getIndustryByName(industryName);
    if (!industry) {
      throw new Error(`Industry "${industryName}" not found. Please use an existing industry ID.`);
    }
  } else {
    throw new Error('Either industryId or industryName is required');
  }

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
