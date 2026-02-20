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

function scoreContact(pageType: string | null): number {
  const pt = (pageType || '').toLowerCase();
  if (pt === 'contact') return 0.9;
  if (pt === 'homepage' || pt === 'footer') return 0.7;
  if (pt === 'about' || pt === 'company') return 0.5;
  return 0.4;
}

async function queryDatasetContacts(
  datasetId: string
): Promise<RawExportRow[]> {
  // First, get all businesses with their basic info (one row per business)
  const businessesResult = await pool.query<{
    business_id: string;
    business_name: string;
    ar_gemi: string | null;
    prefecture: string | null;
    last_gemi_sync: Date | null;
    website: string | null;
  }>(
    `
    SELECT DISTINCT
      b.id AS business_id,
      b.name AS business_name,
      b.ar_gemi,
      p.descr AS prefecture,
      b.updated_at AS last_gemi_sync,
      COALESCE(w.url, b.website_url) AS website
    FROM businesses b
    LEFT JOIN prefectures p ON p.id = b.prefecture_id
    LEFT JOIN websites w ON w.business_id = b.id
    WHERE b.dataset_id = $1
    ORDER BY b.name ASC
    `,
    [datasetId]
  );

  // Then get all contacts for these businesses
  const businessIds = businessesResult.rows.map(r => r.business_id);
  const contactsResult = businessIds.length > 0 ? await pool.query<{
    business_id: string;
    contact_id: number;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    is_generic: boolean | null;
    source_url: string | null;
    page_type: string | null;
  }>(
    `
    SELECT
      cs.business_id,
      ct.id AS contact_id,
      ct.email,
      ct.phone,
      ct.mobile,
      ct.is_generic,
      cs.source_url,
      cs.page_type
    FROM contact_sources cs
    JOIN contacts ct ON ct.id = cs.contact_id
    WHERE cs.business_id = ANY($1)
    ORDER BY cs.business_id, cs.found_at DESC
    `,
    [businessIds]
  ) : { rows: [] };

  // Create a map of contacts by business_id
  type ContactRow = {
    business_id: string;
    contact_id: number;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    is_generic: boolean | null;
    source_url: string | null;
    page_type: string | null;
  };
  const contactsByBusiness = new Map<string, ContactRow[]>();
  for (const contact of contactsResult.rows) {
    if (!contactsByBusiness.has(contact.business_id)) {
      contactsByBusiness.set(contact.business_id, []);
    }
    contactsByBusiness.get(contact.business_id)!.push(contact);
  }

  // Combine businesses with their contacts
  const rawRows: RawExportRow[] = [];
  for (const business of businessesResult.rows) {
    const contacts = contactsByBusiness.get(business.business_id) || [];
    
    if (contacts.length === 0) {
      // Business with no contacts - still include it
      rawRows.push({
        business_id: business.business_id,
        business_name: business.business_name,
        ar_gemi: business.ar_gemi,
        prefecture: business.prefecture,
        last_gemi_sync: business.last_gemi_sync,
        website: business.website,
        contact_id: null,
        email: null,
        phone: null,
        mobile: null,
        is_generic: null,
        source_url: null,
        page_type: null,
      });
    } else {
      // Business with contacts - one row per contact
      for (const contact of contacts) {
        rawRows.push({
          business_id: business.business_id,
          business_name: business.business_name,
          ar_gemi: business.ar_gemi,
          prefecture: business.prefecture,
          last_gemi_sync: business.last_gemi_sync,
          website: business.website,
          contact_id: contact.contact_id,
          email: contact.email,
          phone: contact.phone,
          mobile: contact.mobile,
          is_generic: contact.is_generic,
          source_url: contact.source_url,
          page_type: contact.page_type,
        });
      }
    }
  }

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
  const byBusiness = new Map<string, AggregatedRow & { contacts: RawExportRow[] }>();

  for (const row of rawRows) {
    // Only process rows that have a business_id (skip NULL business rows from LEFT JOINs)
    if (!row.business_id) continue;
    
    if (!byBusiness.has(row.business_id)) {
      byBusiness.set(row.business_id, {
        business_name: row.business_name || 'Unknown Business',
        ar_gemi: row.ar_gemi,
        prefecture: row.prefecture,
        last_gemi_sync: row.last_gemi_sync ? row.last_gemi_sync.toISOString() : null,
        website: row.website,
        email: null,
        phone: null,
        contacts: []
      });
    }
    const agg = byBusiness.get(row.business_id)!;
    // Only add contact if it has contact_id (skip NULL contacts from LEFT JOINs)
    if (row.contact_id) {
      agg.contacts.push(row);
    }
  }

  const result: AggregatedRow[] = [];

  for (const [businessId, agg] of byBusiness.entries()) {
    const contacts = agg.contacts;

    // Find best email and phone from contacts
    let bestEmail: string | null = null;
    let bestPhone: string | null = null;
    let bestEmailScore = 0;
    let bestPhoneScore = 0;

    for (const c of contacts) {
      const pageType = c.page_type;
      const score = scoreContact(pageType);

      if (c.email && score > bestEmailScore) {
        bestEmail = c.email;
        bestEmailScore = score;
      }

      const phoneValue = c.phone || c.mobile;
      if (phoneValue && score > bestPhoneScore) {
        bestPhone = phoneValue;
        bestPhoneScore = score;
      }
    }

    const base: AggregatedRow = {
      business_name: agg.business_name,
      ar_gemi: agg.ar_gemi,
      prefecture: agg.prefecture,
      last_gemi_sync: agg.last_gemi_sync,
      email: bestEmail,
      phone: bestPhone,
      website: agg.website
    };

    result.push(base);
  }

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
  formatInput: string
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

  const rawRows = await queryDatasetContacts(datasetId);
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

