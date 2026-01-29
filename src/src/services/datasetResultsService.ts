/**
 * Dataset Results Service
 * 
 * Fetches businesses with their crawl_results v1 summary for a dataset.
 * Enforces ownership: only returns results if user owns the dataset or is internal.
 */

import { pool } from '../config/database.js';
import { getDatasetById } from '../db/datasets.js';
import { getUserPermissions } from '../db/permissions.js';
import type { Business } from '../types/index.js';

export interface BusinessWithCrawlResult {
  business: {
    id: number;
    name: string;
    address: string | null;
    postal_code: string | null;
    city_id: number;
    industry_id: number | null;
    google_place_id: string | null;
    dataset_id: string;
    owner_user_id: string;
    created_at: Date;
    updated_at: Date;
  };
  crawl: {
    status: 'not_crawled' | 'partial' | 'completed';
    emailsCount: number;
    phonesCount: number;
    socialCount: number;
    finishedAt: string | null;
    pagesVisited: number;
    // Optional raw arrays for detail view
    emails?: Array<{ value: string; source_url: string; context?: string }>;
    phones?: Array<{ value: string; source_url: string }>;
    social?: {
      facebook?: string;
      instagram?: string;
      linkedin?: string;
      twitter?: string;
      youtube?: string;
    };
  };
}

/**
 * Get businesses with crawl results for a dataset
 * 
 * Enforces ownership: only returns results if user owns the dataset or is internal.
 * 
 * @param datasetId - Dataset UUID
 * @param userId - User ID (from auth)
 * @returns Array of businesses with crawl results
 */
export async function getDatasetResults(
  datasetId: string,
  userId: string
): Promise<BusinessWithCrawlResult[]> {
  // 1. Verify dataset ownership
  const dataset = await getDatasetById(datasetId);
  if (!dataset) {
    throw new Error(`Dataset ${datasetId} not found`);
  }

  // 2. Check if user owns the dataset or is internal
  const permissions = await getUserPermissions(userId);
  if (dataset.user_id !== userId && !permissions.is_internal_user) {
    throw new Error(`Access denied: You do not own this dataset`);
  }

  // 3. Query businesses
  const businessesResult = await pool.query<Business>(
    `
    SELECT *
    FROM businesses
    WHERE dataset_id = $1
    ORDER BY created_at DESC
    `,
    [datasetId]
  );

  // 4. Query crawl_results for this dataset
  const crawlResultsResult = await pool.query<{
    business_id: string; // UUID string
    dataset_id: string;
    crawl_status: 'not_crawled' | 'partial' | 'completed';
    emails: Array<{ value: string; source_url: string; context?: string }>;
    phones: Array<{ value: string; source_url: string }>;
    social: {
      facebook?: string;
      instagram?: string;
      linkedin?: string;
      twitter?: string;
      youtube?: string;
    };
    finished_at: string | null;
    pages_visited: number;
  }>(
    `
    SELECT
      business_id,
      dataset_id,
      crawl_status,
      emails,
      phones,
      social,
      finished_at::text AS finished_at,
      pages_visited
    FROM crawl_results
    WHERE dataset_id = $1
    `,
    [datasetId]
  );

  // 5. Convert integer business IDs to UUID format for matching
  // Helper function to convert integer to UUID (same logic as crawlResultsV1.ts)
  function integerToUuid(integerId: number): string {
    const hex = integerId.toString(16).padStart(32, '0');
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
  }

  // Create a map of business_id (UUID) -> crawl_result
  const crawlResultMap = new Map<string, typeof crawlResultsResult.rows[0]>();
  for (const cr of crawlResultsResult.rows) {
    crawlResultMap.set(cr.business_id, cr);
  }

  // 6. Combine businesses with crawl results
  return businessesResult.rows.map((business) => {
    const businessIdUuid = integerToUuid(business.id);
    const crawlResult = crawlResultMap.get(businessIdUuid);
    
    const crawlStatus = crawlResult?.crawl_status || 'not_crawled';
    const emails = crawlResult?.emails || [];
    const phones = crawlResult?.phones || [];
    const social = crawlResult?.social || {};
    
    return {
      business: {
        id: business.id,
        name: business.name,
        address: business.address,
        postal_code: business.postal_code,
        city_id: business.city_id,
        industry_id: business.industry_id,
        google_place_id: business.google_place_id,
        dataset_id: business.dataset_id,
        owner_user_id: business.owner_user_id,
        created_at: business.created_at,
        updated_at: business.updated_at,
      },
      crawl: {
        status: crawlStatus,
        emailsCount: emails.length,
        phonesCount: phones.length,
        socialCount: Object.keys(social).filter(key => social[key as keyof typeof social]).length,
        finishedAt: crawlResult?.finished_at || null,
        pagesVisited: crawlResult?.pages_visited || 0,
        // Include raw arrays for detail view (optional)
        emails: emails.length > 0 ? emails : undefined,
        phones: phones.length > 0 ? phones : undefined,
        social: Object.keys(social).length > 0 ? social : undefined,
      },
    };
  });
}
