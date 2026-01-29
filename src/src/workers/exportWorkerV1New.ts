/**
 * Export Worker v1 - New Implementation
 * 
 * Exports datasets to CSV/XLSX using ExportRowV1 canonical format.
 * 
 * Flow:
 * 1. Fetch businesses for dataset + latest crawl_results per business
 * 2. Map to ExportRowV1 using mapBusinessAndCrawlResultToExportRow()
 * 3. Apply pricing gates (demo max 50 rows)
 * 4. Generate file (CSV or XLSX)
 * 5. Save to storage (Supabase Storage or local filesystem)
 * 6. Insert into exports table
 */

import { pool } from '../config/database.js';
import { getUserPermissions } from '../db/permissions.js';
import { getDatasetById } from '../db/datasets.js';
import { logDatasetExport } from '../db/exports.js';
import type { Business } from '../types/index.js';
import type { CrawlResultV1 } from '../types/crawl.js';
import type { ExportRowV1, BusinessExportInput } from '../types/export.js';
import { mapBusinessAndCrawlResultToExportRow } from '../types/export.js';
import { exportRowV1ToCSV, exportRowV1ToXLSX } from '../exports/exportRowV1Formatters.js';
import { resolveExportStorage } from '../storage/exportStorage.js';
import type { PlanId } from '../types/plan.js';

export interface ExportWorkerV1Input {
  datasetId: string;
  userId: string;
  format: 'csv' | 'xlsx';
  filters?: {
    // Future: add filters here (e.g., industry_id, city_id, etc.)
  };
}

export interface ExportWorkerV1Result {
  success: boolean;
  exportId: string;
  filePath: string;
  downloadUrl: string | null;
  rows_returned: number;
  rows_total: number;
  gated: boolean;
  watermark?: string;
  error?: string;
  upgrade_hint?: string;
}

/**
 * Query businesses and crawl results for a dataset
 */
async function fetchBusinessesWithCrawlResults(
  datasetId: string
): Promise<Array<{
  business: Business;
  industry: { name: string } | null;
  city: { name: string } | null;
  crawlResult: CrawlResultV1 | null;
}>> {
  // Query businesses with related data
  const businessesQuery = await pool.query<{
    id: number;
    name: string;
    normalized_name: string;
    address: string | null;
    postal_code: string | null;
    city_id: number;
    industry_id: number | null;
    google_place_id: string | null;
    dataset_id: string;
    owner_user_id: string;
    created_at: Date;
    updated_at: Date;
    industry_name: string | null;
    city_name: string | null;
  }>(
    `
    SELECT 
      b.id,
      b.name,
      b.normalized_name,
      b.address,
      b.postal_code,
      b.city_id,
      b.industry_id,
      b.google_place_id,
      b.dataset_id,
      b.owner_user_id,
      b.created_at,
      b.updated_at,
      i.name AS industry_name,
      c.name AS city_name
    FROM businesses b
    LEFT JOIN industries i ON b.industry_id = i.id
    LEFT JOIN cities c ON b.city_id = c.id
    WHERE b.dataset_id = $1
    ORDER BY b.created_at ASC
    `,
    [datasetId]
  );

  // Query latest crawl_results per business
  // Note: business_id in crawl_results is UUID, but businesses.id is INTEGER
  // We need to match by converting business.id to string
  const crawlResultsQuery = await pool.query<{
    business_id: string;
    dataset_id: string;
    website_url: string;
    started_at: string;
    finished_at: string;
    pages_visited: number;
    crawl_status: 'not_crawled' | 'partial' | 'completed';
    emails: Array<{ value: string; source_url: string; context?: string }>;
    phones: Array<{ value: string; source_url: string }>;
    contact_pages: string[];
    social: {
      facebook?: string;
      instagram?: string;
      linkedin?: string;
      twitter?: string;
      youtube?: string;
    };
    errors: Array<{ url: string; message: string }>;
  }>(
    `
    SELECT DISTINCT ON (business_id)
      business_id,
      dataset_id,
      website_url,
      started_at::text,
      finished_at::text,
      pages_visited,
      crawl_status,
      emails,
      phones,
      contact_pages,
      social,
      errors
    FROM crawl_results
    WHERE dataset_id = $1
    ORDER BY business_id, finished_at DESC NULLS LAST
    `,
    [datasetId]
  );

  // Create a map of business_id -> crawl_result
  const crawlResultMap = new Map<string, CrawlResultV1>();
  for (const cr of crawlResultsQuery.rows) {
    crawlResultMap.set(cr.business_id, {
      business_id: cr.business_id,
      dataset_id: cr.dataset_id,
      website_url: cr.website_url,
      started_at: cr.started_at,
      finished_at: cr.finished_at,
      pages_visited: cr.pages_visited,
      crawl_status: cr.crawl_status,
      emails: cr.emails,
      phones: cr.phones,
      contact_pages: cr.contact_pages,
      social: cr.social,
      errors: cr.errors,
    });
  }

  // Combine businesses with crawl results
  return businessesQuery.rows.map((row) => {
    const business: Business = {
      id: row.id,
      name: row.name,
      normalized_name: row.normalized_name,
      address: row.address,
      postal_code: row.postal_code,
      city_id: row.city_id,
      industry_id: row.industry_id,
      google_place_id: row.google_place_id,
      dataset_id: row.dataset_id,
      owner_user_id: row.owner_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    // Find crawl result for this business (match by business_id as string)
    const crawlResult = crawlResultMap.get(String(business.id)) || null;

    return {
      business,
      industry: row.industry_name ? { name: row.industry_name } : null,
      city: row.city_name ? { name: row.city_name } : null,
      crawlResult,
    };
  });
}

/**
 * Apply pricing gates to export rows
 */
function applyPricingGates(
  rows: ExportRowV1[],
  planId: PlanId,
  isInternalUser: boolean
): {
  rows: ExportRowV1[];
  gated: boolean;
  watermark?: string;
  upgrade_hint?: string;
} {
  // Internal users bypass all limits
  if (isInternalUser) {
    return {
      rows,
      gated: false,
    };
  }

  // Demo plan: max 50 rows
  if (planId === 'demo') {
    const maxRows = 50;
    const isTruncated = rows.length > maxRows;
    const gatedRows = rows.slice(0, maxRows);

    return {
      rows: gatedRows,
      gated: isTruncated,
      watermark: isTruncated ? 'DEMO EXPORT - Limited to 50 rows' : undefined,
      upgrade_hint: isTruncated
        ? 'Upgrade to Starter plan for up to 1,000 rows per export'
        : undefined,
    };
  }

  // Starter/Pro: no row limit for now (structured for future quotas)
  return {
    rows,
    gated: false,
  };
}

/**
 * Export Worker v1 - Main function
 */
export async function exportWorkerV1New(
  input: ExportWorkerV1Input
): Promise<ExportWorkerV1Result> {
  const { datasetId, userId, format, filters } = input;

  try {
    // 1. Verify dataset exists and belongs to user
    const dataset = await getDatasetById(datasetId);
    if (!dataset) {
      return {
        success: false,
        exportId: '',
        filePath: '',
        downloadUrl: null,
        rows_returned: 0,
        rows_total: 0,
        gated: false,
        error: 'Dataset not found',
      };
    }

    if (dataset.user_id !== userId) {
      return {
        success: false,
        exportId: '',
        filePath: '',
        downloadUrl: null,
        rows_returned: 0,
        rows_total: 0,
        gated: false,
        error: 'Dataset does not belong to user',
      };
    }

    // 2. Get user permissions (for pricing gates)
    const permissions = await getUserPermissions(userId);
    const planId = permissions.plan;
    const isInternalUser = permissions.is_internal_user;

    // 3. Fetch businesses and crawl results
    const businessesWithCrawl = await fetchBusinessesWithCrawlResults(datasetId);
    const rowsTotal = businessesWithCrawl.length;

    // 4. Map to ExportRowV1
    const exportRows: ExportRowV1[] = businessesWithCrawl.map((item) => {
      const input: BusinessExportInput = {
        business: item.business,
        industry: item.industry,
        city: item.city,
        crawlResult: item.crawlResult,
      };
      return mapBusinessAndCrawlResultToExportRow(input);
    });

    // 5. Apply pricing gates
    const gated = applyPricingGates(exportRows, planId, isInternalUser);
    const finalRows = gated.rows;
    const rowsReturned = finalRows.length;

    // 6. Generate file
    const exportId = crypto.randomUUID();
    const timestamp = Date.now();
    const filename = `export-${datasetId}-${timestamp}.${format}`;

    let fileBuffer: Buffer;
    let contentType: string;

    if (format === 'csv') {
      const csvContent = exportRowV1ToCSV(finalRows);
      fileBuffer = Buffer.from(csvContent, 'utf-8');
      contentType = 'text/csv; charset=utf-8';
    } else {
      fileBuffer = await exportRowV1ToXLSX(finalRows, gated.watermark);
      contentType =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }

    // 7. Save to storage
    const storage = await resolveExportStorage();
    const storageResult = await storage.saveExport(
      userId,
      filename,
      fileBuffer,
      contentType,
      7 // expires in 7 days
    );

    // 8. Insert into exports table
    const watermarkText = gated.watermark || '';
    await logDatasetExport({
      datasetId,
      userId,
      tier: planId,
      format,
      rowCount: rowsReturned,
      filePath: storageResult.filePath,
      watermarkText,
    });

    return {
      success: true,
      exportId,
      filePath: storageResult.filePath,
      downloadUrl: storageResult.downloadUrl,
      rows_returned: rowsReturned,
      rows_total: rowsTotal,
      gated: gated.gated,
      watermark: gated.watermark,
      upgrade_hint: gated.upgrade_hint,
    };
  } catch (error: any) {
    console.error('[exportWorkerV1New] Error:', error);
    return {
      success: false,
      exportId: '',
      filePath: '',
      downloadUrl: null,
      rows_returned: 0,
      rows_total: 0,
      gated: false,
      error: error.message || 'Export failed',
    };
  }
}
