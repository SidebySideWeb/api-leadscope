/**
 * Export Worker v1
 * 
 * Exports dataset leads to CSV from Postgres, writes audit record to exports table,
 * and enforces plan limits.
 * 
 * Requirements:
 * - Source: businesses LEFT JOIN crawl_results (v1)
 * - Export scope: one datasetId for authenticated user
 * - Plans: demo (50), starter (1000), pro (unlimited)
 */

import { pool } from '../config/database.js';
import { getDatasetById } from '../db/datasets.js';
import { applyExportGate, type Plan } from '../core/planLimits.js';
import { incrementExports } from '../db/usageTracking.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface ExportDatasetToCsvParams {
  datasetId: string;
  userId: string;
  plan: Plan;
}

export interface ExportDatasetToCsvResult {
  success: boolean;
  exportId: string | null;
  filePath: string | null;
  rowsExported: number;
  rowsTotal: number;
  watermark: string;
  error?: string;
}

/**
 * Convert integer business ID to UUID format (same logic as crawlResultsV1.ts)
 */
function integerToUuid(integerId: number): string {
  const hex = integerId.toString(16).padStart(32, '0');
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

/**
 * Escape CSV field (handles commas, quotes, newlines)
 */
function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  // If contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Export dataset to CSV
 */
export async function exportDatasetToCsv(
  params: ExportDatasetToCsvParams
): Promise<ExportDatasetToCsvResult> {
  const { datasetId, userId, plan } = params;

  try {
    // 1. Verify dataset ownership
    const dataset = await getDatasetById(datasetId);
    if (!dataset) {
      return {
        success: false,
        exportId: null,
        filePath: null,
        rowsExported: 0,
        rowsTotal: 0,
        watermark: '',
        error: `Dataset ${datasetId} not found`,
      };
    }

    if (dataset.user_id !== userId) {
      return {
        success: false,
        exportId: null,
        filePath: null,
        rowsExported: 0,
        rowsTotal: 0,
        watermark: '',
        error: `Access denied: You do not own this dataset`,
      };
    }

    // 2. Query businesses with website URLs
    const businessesQuery = await pool.query<{
      id: number;
      name: string;
      address: string | null;
      google_place_id: string | null;
      dataset_id: string;
      website_url: string | null;
    }>(
      `
      SELECT 
        b.id, 
        b.name, 
        b.address, 
        b.google_place_id, 
        b.dataset_id,
        (SELECT url FROM websites WHERE business_id = b.id ORDER BY created_at DESC LIMIT 1) AS website_url
      FROM businesses b
      WHERE b.dataset_id = $1
      ORDER BY b.created_at DESC
      `,
      [datasetId]
    );

    // 3. Query crawl_results for this dataset
    // IMPORTANT: JSONB columns are returned as strings by pg driver, we need to parse them
    // Also, business_id is UUID but businesses.id is integer - need to match them
    const crawlResultsQuery = await pool.query<{
      business_id: string;
      dataset_id: string;
      website_url: string | null;
      crawl_status: 'not_crawled' | 'partial' | 'completed';
      emails: string; // JSONB returned as string
      phones: string; // JSONB returned as string
      social: string; // JSONB returned as string
      finished_at: string | null;
    }>(
      `
      SELECT
        business_id,
        dataset_id,
        website_url,
        crawl_status,
        emails::text AS emails,
        phones::text AS phones,
        social::text AS social,
        finished_at::text AS finished_at
      FROM crawl_results
      WHERE dataset_id = $1
      `,
      [datasetId]
    );

    console.log(`[exportWorkerV1] Found ${crawlResultsQuery.rows.length} crawl_results`);
    if (crawlResultsQuery.rows.length > 0) {
      const sample = crawlResultsQuery.rows[0];
      console.log(`[exportWorkerV1] Sample crawl_result business_id: ${sample.business_id}`);
      console.log(`[exportWorkerV1] Sample emails (raw): ${sample.emails?.substring(0, 100)}`);
      console.log(`[exportWorkerV1] Sample phones (raw): ${sample.phones?.substring(0, 100)}`);
    }

    // 4. Create map of business_id (UUID) -> crawl_result
    const crawlResultMap = new Map<string, typeof crawlResultsQuery.rows[0]>();
    for (const cr of crawlResultsQuery.rows) {
      crawlResultMap.set(cr.business_id, cr);
    }

    // 4b. Also create reverse map: try to find which business integer ID matches each UUID
    // This handles cases where UUID was stored directly (not converted from integer)
    const uuidToBusinessIdMap = new Map<string, number>();
    for (const business of businessesQuery.rows) {
      const convertedUuid = integerToUuid(business.id);
      uuidToBusinessIdMap.set(convertedUuid, business.id);
    }

    // 5. Convert to flat CSV rows
    const allRows: Array<{
      business_id: string;
      business_name: string;
      address: string;
      website: string;
      emails: string;
      phones: string;
      social: string;
      crawl_status: string;
      last_crawled_at: string;
      dataset_id: string;
    }> = [];

    // 4c. Create a map from business integer ID -> crawl_result
    // IMPORTANT: We need to match UUIDs in crawl_results to integer business IDs
    // The UUID "f9cfb252-177d-47dd-824a-4e2c834c445b" might be a real UUID, not converted from integer
    // So we need to check ALL crawl_results and see if we can find the business by other means
    
    const businessIdToCrawlResultMap = new Map<number, typeof crawlResultsQuery.rows[0]>();
    
    console.log(`[exportWorkerV1] Matching ${businessesQuery.rows.length} businesses to ${crawlResultsQuery.rows.length} crawl_results`);
    
    // First, try to match by UUID conversion (forward and reverse)
    for (const business of businessesQuery.rows) {
      // Method 1: Convert business.id to UUID and look it up
      const businessIdUuid = integerToUuid(business.id);
      let crawlResult = crawlResultMap.get(businessIdUuid);
      
      // Method 2: If not found, try reverse lookup - extract integer from each UUID
      if (!crawlResult) {
        for (const [uuid, cr] of crawlResultMap.entries()) {
          // Extract first 16 hex chars from UUID and convert to integer
          const uuidHex = uuid.replace(/-/g, '').substring(0, 16);
          const possibleIntId = parseInt(uuidHex, 16);
          if (possibleIntId === business.id) {
            crawlResult = cr;
            console.log(`[exportWorkerV1] Matched business ${business.id} to crawl_result UUID ${uuid} (reverse lookup)`);
            break;
          }
        }
      } else {
        console.log(`[exportWorkerV1] Matched business ${business.id} to crawl_result UUID ${businessIdUuid} (forward lookup)`);
      }
      
      if (crawlResult) {
        businessIdToCrawlResultMap.set(business.id, crawlResult);
      }
    }
    
    // Method 3: If crawl_result has website_url, try to match by website
    // This handles cases where UUID doesn't match but we have the website
    for (const cr of crawlResultsQuery.rows) {
      // Skip if already matched
      if (Array.from(businessIdToCrawlResultMap.values()).includes(cr)) {
        continue;
      }
      
      // Try to find business by website URL
      if (cr.website_url) {
        for (const business of businessesQuery.rows) {
          if (business.website_url === cr.website_url && !businessIdToCrawlResultMap.has(business.id)) {
            businessIdToCrawlResultMap.set(business.id, cr);
            console.log(`[exportWorkerV1] Matched business ${business.id} to crawl_result UUID ${cr.business_id} (by website: ${cr.website_url})`);
            break;
          }
        }
      }
    }
    
    console.log(`[exportWorkerV1] Successfully matched ${businessIdToCrawlResultMap.size} businesses to crawl_results`);
    if (crawlResultsQuery.rows.length > businessIdToCrawlResultMap.size) {
      const unmatched = crawlResultsQuery.rows.filter(cr => !Array.from(businessIdToCrawlResultMap.values()).includes(cr));
      console.log(`[exportWorkerV1] WARNING: ${unmatched.length} crawl_results could not be matched to businesses`);
      for (const cr of unmatched) {
        console.log(`[exportWorkerV1]   Unmatched UUID: ${cr.business_id}, website: ${cr.website_url}`);
      }
    }

    // 5. Convert to flat CSV rows
    for (const business of businessesQuery.rows) {
      // Get crawl result from our map
      const crawlResult = businessIdToCrawlResultMap.get(business.id);

      // Parse JSONB columns - they come as strings from PostgreSQL
      let emails: Array<{ value: string; source_url: string; context?: string }> = [];
      let phones: Array<{ value: string; source_url: string }> = [];
      let social: { facebook?: string; instagram?: string; linkedin?: string; twitter?: string; youtube?: string } = {};

      if (crawlResult) {
        // Parse emails - always a string from JSONB
        if (crawlResult.emails) {
          try {
            const parsed = JSON.parse(crawlResult.emails);
            emails = Array.isArray(parsed) ? parsed : [];
          } catch (e) {
            console.warn(`[exportWorkerV1] Failed to parse emails for business ${business.id}: ${crawlResult.emails}`);
          }
        }

        // Parse phones - always a string from JSONB
        if (crawlResult.phones) {
          try {
            const parsed = JSON.parse(crawlResult.phones);
            phones = Array.isArray(parsed) ? parsed : [];
          } catch (e) {
            console.warn(`[exportWorkerV1] Failed to parse phones for business ${business.id}: ${crawlResult.phones}`);
          }
        }

        // Parse social - always a string from JSONB
        if (crawlResult.social) {
          try {
            const parsed = JSON.parse(crawlResult.social);
            social = typeof parsed === 'object' && parsed !== null ? parsed : {};
          } catch (e) {
            console.warn(`[exportWorkerV1] Failed to parse social for business ${business.id}: ${crawlResult.social}`);
          }
        }
        
        console.log(`[exportWorkerV1] Business ${business.id}: emails=${emails.length}, phones=${phones.length}, status=${crawlResult.crawl_status}`);
      } else {
        console.log(`[exportWorkerV1] Business ${business.id}: NO crawl_result found`);
      }

      // Get website from crawl_result first, fallback to websites table
      const website = crawlResult?.website_url || business.website_url || '';

      // Extract email/phone values safely - handle both object format {value, source_url} and direct strings
      const emailValues: string[] = [];
      if (Array.isArray(emails) && emails.length > 0) {
        for (const email of emails) {
          if (typeof email === 'object' && email !== null && 'value' in email) {
            emailValues.push(email.value);
          } else if (typeof email === 'string') {
            emailValues.push(email);
          }
        }
      }

      const phoneValues: string[] = [];
      if (Array.isArray(phones) && phones.length > 0) {
        for (const phone of phones) {
          if (typeof phone === 'object' && phone !== null && 'value' in phone) {
            phoneValues.push(phone.value);
          } else if (typeof phone === 'string') {
            phoneValues.push(phone);
          }
        }
      }

      allRows.push({
        business_id: String(business.id),
        business_name: business.name,
        address: business.address || '',
        website: website,
        emails: emailValues.length > 0 ? emailValues.join('|') : '',
        phones: phoneValues.length > 0 ? phoneValues.join('|') : '',
        social: Object.keys(social).length > 0 ? JSON.stringify(social) : '',
        crawl_status: crawlResult?.crawl_status || 'not_crawled',
        last_crawled_at: crawlResult?.finished_at || '',
        dataset_id: datasetId,
      });
    }

    const rowsTotal = allRows.length;

    // 6. Apply plan-based gating using centralized limits
    const gateResult = applyExportGate(plan, rowsTotal);
    const rowsToExport = allRows.slice(0, gateResult.rows);
    const watermark = gateResult.watermarkText;
    const rowsExported = rowsToExport.length;

    // 7. Generate CSV content
    const headers = [
      'business_id',
      'business_name',
      'address',
      'website',
      'emails',
      'phones',
      'social',
      'crawl_status',
      'last_crawled_at',
      'dataset_id',
    ];

    const csvRows: string[] = [];
    csvRows.push(headers.map(escapeCsvField).join(','));

    for (const row of rowsToExport) {
      const values = [
        row.business_id,
        row.business_name,
        row.address,
        row.website,
        row.emails,
        row.phones,
        row.social,
        row.crawl_status,
        row.last_crawled_at,
        row.dataset_id,
      ];
      csvRows.push(values.map(escapeCsvField).join(','));
    }

    // Add watermark as comment row
    if (watermark) {
      csvRows.push(`# ${watermark}`);
    }

    const csvContent = csvRows.join('\n');

    // 8. Write file to local disk with UTF-8 BOM for Excel compatibility
    const exportDir = path.join(process.cwd(), 'data', 'exports', userId, datasetId);
    await fs.mkdir(exportDir, { recursive: true });

    const timestamp = Date.now();
    const filename = `${timestamp}.csv`;
    const filePath = path.join(exportDir, filename);

    // Add UTF-8 BOM for Excel to properly recognize Greek characters
    const BOM = '\uFEFF';
    const csvWithBOM = BOM + csvContent;
    await fs.writeFile(filePath, csvWithBOM, 'utf-8');

    // 9. Insert audit record into exports table
    const exportId = randomUUID();
    const filters = JSON.stringify({ datasetId, plan });

    await pool.query(
      `
      INSERT INTO exports (
        id,
        user_id,
        export_type,
        total_rows,
        file_format,
        file_path,
        watermark_text,
        filters,
        expires_at
      )
      VALUES ($1, $2, 'subscription', $3, 'csv', $4, $5, $6::jsonb, NULL)
      `,
      [exportId, userId, rowsExported, filePath, watermark, filters]
    );

    // 10. Increment usage tracking
    try {
      await incrementExports(userId);
    } catch (usageError: any) {
      // Log but don't fail export if usage tracking fails
      console.warn(`[exportWorkerV1] Failed to increment usage tracking: ${usageError.message}`);
    }

    // 11. Logging
    console.log(`[exportWorkerV1] Exported ${rowsExported} rows (of ${rowsTotal} total) to ${filePath}`);
    console.log(`[exportWorkerV1] Export ID: ${exportId}, Plan: ${plan}, Watermark: ${watermark}`);
    if (gateResult.gated) {
      console.log(`[exportWorkerV1] Export was gated: ${rowsTotal} rows requested, ${rowsExported} rows exported`);
    }

    return {
      success: true,
      exportId,
      filePath,
      rowsExported,
      rowsTotal,
      watermark,
    };
  } catch (error: any) {
    console.error('[exportWorkerV1] Error:', error);
    return {
      success: false,
      exportId: null,
      filePath: null,
      rowsExported: 0,
      rowsTotal: 0,
      watermark: '',
      error: error.message || 'Export failed',
    };
  }
}
