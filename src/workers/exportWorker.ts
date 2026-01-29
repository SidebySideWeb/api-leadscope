import fs from 'fs/promises';
import path from 'path';
import { pool } from '../config/database.js';
import { getDatasetById } from '../db/datasets.js';
import { logDatasetExport, type ExportFormat } from '../db/exports.js';
import { buildXlsxFile, type XlsxColumn } from '../utils/xlsx.js';
import {
  getTierEntitlements,
  parseTier,
  parseFormat,
  type ExportTier
} from '../billing/entitlements.js';

interface RawExportRow {
  business_id: number;
  dataset_id: string;
  business_name: string;
  industry: string;
  city: string;
  website: string | null;
  last_crawled_at: Date | null;
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
  industry: string;
  city: string;
  website: string | null;
  best_email: string | null;
  best_phone: string | null;
  all_emails?: string;
  all_phones?: string;
  social_links?: string;
  contact_page_url?: string | null;
  has_contact_form?: boolean;
  last_crawled_at?: string | null;
  contact_confidence?: string;
  contact_sources?: string;
  pages_crawled?: number;
  dataset_watermark?: string;
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
  const result = await pool.query<RawExportRow>(
    `
    SELECT
      b.id AS business_id,
      b.dataset_id,
      b.name AS business_name,
      i.name AS industry,
      c.name AS city,
      w.url AS website,
      w.last_crawled_at,
      ct.id AS contact_id,
      ct.email,
      ct.phone,
      ct.mobile,
      ct.is_generic,
      cs.source_url,
      cs.page_type
    FROM businesses b
    JOIN industries i ON b.industry_id = i.id
    JOIN cities c ON b.city_id = c.id
    LEFT JOIN websites w ON w.business_id = b.id
    LEFT JOIN contact_sources cs ON cs.source_url IS NOT NULL
    LEFT JOIN contacts ct ON ct.id = cs.contact_id
    WHERE b.dataset_id = $1
    ORDER BY b.name ASC, ct.last_verified_at DESC NULLS LAST
    `,
    [datasetId]
  );

  return result.rows;
}

async function countPagesCrawledForDataset(datasetId: string): Promise<
  Map<number, number>
> {
  const result = await pool.query<{ business_id: number; pages: number }>(
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

  const map = new Map<number, number>();
  for (const row of result.rows) {
    map.set(row.business_id, Number(row.pages) || 0);
  }
  return map;
}

function aggregateRows(
  rawRows: RawExportRow[],
  pagesMap: Map<number, number>,
  tier: ExportTier,
  datasetId: string
): AggregatedRow[] {
  const byBusiness = new Map<number, AggregatedRow & { contacts: RawExportRow[] }>();

  for (const row of rawRows) {
    if (!byBusiness.has(row.business_id)) {
      byBusiness.set(row.business_id, {
        business_name: row.business_name,
        industry: row.industry,
        city: row.city,
        website: row.website,
        best_email: null,
        best_phone: null,
        contacts: []
      });
    }
    const agg = byBusiness.get(row.business_id)!;
    agg.contacts.push(row);
  }

  const result: AggregatedRow[] = [];

  for (const [businessId, agg] of byBusiness.entries()) {
    const contacts = agg.contacts;

    const emails = new Map<string, { score: number; source: string | null }>();
    const phones = new Map<string, { score: number; source: string | null }>();
    const sourcesForConfidence: string[] = [];

    let contactPageUrl: string | null = null;

    for (const c of contacts) {
      const pageType = c.page_type;
      const score = scoreContact(pageType);

      if (c.source_url && pageType === 'contact') {
        contactPageUrl = c.source_url;
      }

      if (c.email) {
        const key = c.email.toLowerCase();
        const existing = emails.get(key);
        if (!existing || score > existing.score) {
          emails.set(key, { score, source: c.source_url });
        }
        sourcesForConfidence.push(`${key}:${score.toFixed(2)}`);
      }

      const phoneValue = c.phone || c.mobile;
      if (phoneValue) {
        const key = phoneValue;
        const existing = phones.get(key);
        if (!existing || score > existing.score) {
          phones.set(key, { score, source: c.source_url });
        }
        sourcesForConfidence.push(`${key}:${score.toFixed(2)}`);
      }
    }

    const bestEmailEntry = Array.from(emails.entries()).sort(
      (a, b) => b[1].score - a[1].score
    )[0];
    const bestPhoneEntry = Array.from(phones.entries()).sort(
      (a, b) => b[1].score - a[1].score
    )[0];

    const allEmails =
      tier === 'starter'
        ? undefined
        : Array.from(emails.keys()).join('; ');
    const allPhones =
      tier === 'starter'
        ? undefined
        : Array.from(phones.keys()).join('; ');

    const pagesCrawled = pagesMap.get(businessId) || 0;

    const base: AggregatedRow = {
      business_name: agg.business_name,
      industry: agg.industry,
      city: agg.city,
      website: agg.website,
      best_email: bestEmailEntry ? bestEmailEntry[0] : null,
      best_phone: bestPhoneEntry ? bestPhoneEntry[0] : null
    };

    if (tier === 'pro' || tier === 'agency') {
      base.all_emails = allEmails || '';
      base.all_phones = allPhones || '';
      base.social_links = ''; // placeholder – socials would require HTML re-scan
      base.contact_page_url = contactPageUrl;
      base.has_contact_form = false; // could be derived from crawl_pages HTML if needed
      base.last_crawled_at = agg.website
        ? null
        : null; // simplified: can be expanded with websites.last_crawled_at
    }

    if (tier === 'agency') {
      base.contact_confidence = sourcesForConfidence.join(' | ');
      base.contact_sources = Array.from(
        new Set(contacts.map(c => c.source_url).filter(Boolean) as string[])
      ).join('; ');
      base.pages_crawled = pagesCrawled;
      base.dataset_watermark = datasetId;
    }

    result.push(base);
  }

  return result;
}

function buildColumnsForTier(tier: ExportTier): XlsxColumn[] {
  const entitlements = getTierEntitlements(tier);

  const headerMap: Record<string, string> = {
    business_name: 'Business Name',
    industry: 'Industry',
    city: 'City',
    website: 'Website',
    best_email: 'Best Email',
    best_phone: 'Best Phone',
    all_emails: 'All Emails',
    all_phones: 'All Phones',
    social_links: 'Social Links',
    contact_page_url: 'Contact Page URL',
    has_contact_form: 'Has Contact Form',
    last_crawled_at: 'Last Crawled At',
    contact_confidence: 'Contact Confidence',
    contact_sources: 'Contact Sources',
    pages_crawled: 'Pages Crawled',
    dataset_watermark: 'Dataset Watermark'
  };

  return entitlements.columns.map(key => ({
    header: headerMap[key] ?? key,
    key,
    width: 25
  }));
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
  const pagesMap = await countPagesCrawledForDataset(datasetId);
  const aggregated = aggregateRows(rawRows, pagesMap, tier, datasetId);

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

