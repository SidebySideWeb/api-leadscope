import fs from 'fs/promises';
import path from 'path';
import { pool } from '../config/database.js';
import { getDatasetById } from '../db/datasets.js';
import { logDatasetExport, type ExportFormat } from '../db/exports.js';
import { buildXlsxFile, type XlsxColumn } from '../utils/xlsx.js';
import {
  parseTier,
  parseFormat,
  type ExportTier
} from '../billing/entitlements.js';

interface RawExportRow {
  business_id: string; // UUID
  business_name: string;
  ar_gemi: string | null;
  prefecture: string | null;
  last_gemi_sync: Date | null;
  website: string | null;
  contact_id: number | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  is_generic: boolean | null;
  source_url: string | null;
  page_type: string | null;
}

interface AggregatedRow {
  business_name: string;
  ar_gemi: string | null;
  prefecture: string | null;
  last_gemi_sync: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
}

async function queryDatasetContacts(
  datasetId: string,
  startRow?: number,
  endRow?: number
): Promise<RawExportRow[]> {
  // Build query with optional row range (alphabetical order by default)
  let query = `
    SELECT DISTINCT
      b.id AS business_id,
      b.name AS business_name,
      b.ar_gemi,
      p.descr AS prefecture,
      b.updated_at AS last_gemi_sync,
      b.email,
      b.phone,
      COALESCE(w.url, b.website_url) AS website
    FROM businesses b
    LEFT JOIN prefectures p ON p.id = b.prefecture_id
    LEFT JOIN websites w ON w.business_id = b.id
    WHERE b.dataset_id = $1
    ORDER BY b.name ASC
  `;
  
  const queryParams: any[] = [datasetId];
  
  // Add LIMIT and OFFSET if row range is specified
  if (startRow !== undefined && endRow !== undefined) {
    const limit = endRow - startRow + 1;
    const offset = startRow - 1; // OFFSET is 0-based
    query += ` LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);
  }
  
  // Get businesses with their data directly from businesses table
  const businessesResult = await pool.query<{
    business_id: string;
    business_name: string;
    ar_gemi: string | null;
    prefecture: string | null;
    last_gemi_sync: Date | null;
    email: string | null;
    phone: string | null;
    website: string | null;
  }>(query, queryParams);

  // Convert to RawExportRow format (one row per business)
  const rawRows: RawExportRow[] = businessesResult.rows.map(business => ({
    business_id: business.business_id,
    business_name: business.business_name,
    ar_gemi: business.ar_gemi,
    prefecture: business.prefecture,
    last_gemi_sync: business.last_gemi_sync,
    website: business.website,
    contact_id: null,
    email: business.email,
    phone: business.phone,
    mobile: null,
    is_generic: null,
    source_url: null,
    page_type: null,
  }));

  return rawRows;
}

async function countPagesCrawledForDataset(datasetId: string): Promise<
  Map<string, number>
> {
  const result = await pool.query<{ business_id: string; pages: number }>(
    `
    SELECT
      w.business_id,
      COUNT(cp.id) AS pages
    FROM crawl_pages cp
    JOIN crawl_jobs cj ON cp.crawl_job_id = cj.id
    JOIN websites w ON cj.website_id = w.id
    JOIN businesses b ON w.business_id = b.id
    WHERE b.dataset_id = $1
    GROUP BY w.business_id
    `,
    [datasetId]
  );

  const map = new Map<string, number>();
  for (const row of result.rows) {
    map.set(row.business_id, Number(row.pages) || 0);
  }
  return map;
}

function aggregateRows(
  rawRows: RawExportRow[],
  pagesMap: Map<string, number>,
  tier: ExportTier,
  datasetId: string
): AggregatedRow[] {
  // Since we're getting data directly from businesses table, each row is already one business
  // Just convert to AggregatedRow format
  const result: AggregatedRow[] = rawRows.map(row => ({
    business_name: row.business_name || 'Unknown Business',
    ar_gemi: row.ar_gemi,
    prefecture: row.prefecture,
    last_gemi_sync: row.last_gemi_sync ? row.last_gemi_sync.toISOString() : null,
    email: row.email,
    phone: row.phone || row.mobile, // Use phone or mobile from businesses table
    website: row.website
  }));

  return result;
}

function buildColumnsForTier(tier: ExportTier): XlsxColumn[] {
  // Define the columns in the order requested
  const columns: XlsxColumn[] = [
    { header: 'Business Name', key: 'business_name', width: 30 },
    { header: 'AR GEMI', key: 'ar_gemi', width: 20 },
    { header: 'Prefecture', key: 'prefecture', width: 25 },
    { header: 'Last GEMI Sync', key: 'last_gemi_sync', width: 20 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Phone', key: 'phone', width: 20 },
    { header: 'Website', key: 'website', width: 40 }
  ];

  return columns;
}

function buildCsvContent(
  rows: AggregatedRow[],
  columns: XlsxColumn[]
): string {
  const headers = columns.map(col => col.header);
  const lines: string[] = [];
  lines.push(headers.join(','));

  for (const row of rows) {
    const values = columns.map(col => {
      const raw = (row as unknown as Record<string, unknown>)[col.key];
      if (raw === null || raw === undefined) return '';
      const str = String(raw);
      if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

export async function runDatasetExport(
  datasetId: string,
  tierInput: string,
  formatInput: string,
  startRow?: number,
  endRow?: number
): Promise<string> {
  const tier = parseTier(tierInput);
  const format = parseFormat(formatInput) as ExportFormat;

  if (!datasetId || datasetId.length === 0) {
    throw new Error('datasetId is required');
  }

  const dataset = await getDatasetById(datasetId);
  if (!dataset) {
    throw new Error(`Dataset ${datasetId} not found`);
  }

  const rawRows = await queryDatasetContacts(datasetId, startRow, endRow);
  console.log(`[exportWorker] Query returned ${rawRows.length} raw rows for dataset ${datasetId}`);
  
  if (rawRows.length === 0) {
    console.warn(`[exportWorker] No businesses found for dataset ${datasetId}. Checking if businesses exist...`);
    // Check if businesses exist in the dataset
    const businessCheck = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM businesses WHERE dataset_id = $1',
      [datasetId]
    );
    const businessCount = parseInt(businessCheck.rows[0]?.count || '0', 10);
    console.log(`[exportWorker] Found ${businessCount} businesses in dataset ${datasetId}`);
    
    if (businessCount === 0) {
      throw new Error(`No businesses found in dataset ${datasetId}. Please ensure the dataset contains businesses before exporting.`);
    }
  }
  
  const pagesMap = await countPagesCrawledForDataset(datasetId);
  const aggregated = aggregateRows(rawRows, pagesMap, tier, datasetId);
  console.log(`[exportWorker] Aggregated ${aggregated.length} businesses for export`);
  
  if (aggregated.length === 0) {
    throw new Error(`No data to export. The dataset may not have any businesses with valid data.`);
  }

  const columns = buildColumnsForTier(tier);
  const watermark =
    tier === 'agency'
      ? `Dataset ${datasetId} – agency export`
      : `Dataset ${datasetId} – ${tier} export`;

  const rowsForFile = aggregated.map(row => {
    const output: Record<string, unknown> = {};
    for (const col of columns) {
      output[col.key] =
        (row as unknown as Record<string, unknown>)[col.key] ?? '';
    }
    return output;
  });

  const exportsDir = path.join(process.cwd(), 'exports');
  await fs.mkdir(exportsDir, { recursive: true });

  const filename = `dataset-${datasetId}-${tier}-${Date.now()}.${format}`;
  const filePath = path.join(exportsDir, filename);

  if (format === 'xlsx') {
    const buffer = await buildXlsxFile(
      rowsForFile,
      columns,
      'Dataset Export',
      watermark
    );
    await fs.writeFile(filePath, buffer);
  } else {
    const csv = buildCsvContent(aggregated, columns);
    const contentWithWatermark =
      tier === 'agency'
        ? `${csv}\n# Dataset: ${datasetId}`
        : csv;
    await fs.writeFile(filePath, contentWithWatermark, 'utf8');
  }

  await logDatasetExport({
    datasetId,
    userId: dataset.user_id,
    tier,
    format,
    rowCount: aggregated.length,
    filePath,
    watermarkText: watermark
  });

  return filePath;
}

