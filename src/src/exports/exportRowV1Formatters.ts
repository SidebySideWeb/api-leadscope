/**
 * Export Row V1 Formatters
 * 
 * Converts ExportRowV1 to CSV and XLSX formats.
 */

// @ts-ignore - exceljs types issue with default export
import ExcelJS from 'exceljs';
import type { ExportRowV1 } from '../types/export.js';

/**
 * Escape CSV value (RFC4180 compatible, UTF-8 safe)
 * Handles Greek characters and special characters correctly
 */
function escapeCSV(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  // If contains comma, newline, or double quote, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Convert ExportRowV1 to CSV format (UTF-8, Greek compatible)
 */
export function exportRowV1ToCSV(rows: ExportRowV1[]): string {
  if (rows.length === 0) {
    return '';
  }

  // Define CSV columns (flat structure for ExportRowV1)
  const headers = [
    'dataset_id',
    'business_id',
    'business_name',
    'business_address',
    'city',
    'industry',
    'website_url',
    'emails', // Array as comma-separated string
    'phones', // Array as comma-separated string
    'social_facebook',
    'social_instagram',
    'social_linkedin',
    'social_tiktok',
    'social_youtube',
    'social_x',
    'social_website',
    'last_crawled_at',
    'crawl_status',
    'pages_visited',
  ];

  const lines: string[] = [];

  // Header row
  lines.push(headers.map(h => escapeCSV(h)).join(','));

  // Data rows
  for (const row of rows) {
    const values = [
      escapeCSV(row.dataset_id),
      escapeCSV(row.business_id),
      escapeCSV(row.business_name),
      escapeCSV(row.business_address),
      escapeCSV(row.city),
      escapeCSV(row.industry),
      escapeCSV(row.website_url),
      escapeCSV(row.emails.join('; ')), // Join array with semicolon
      escapeCSV(row.phones.join('; ')), // Join array with semicolon
      escapeCSV(row.social.facebook),
      escapeCSV(row.social.instagram),
      escapeCSV(row.social.linkedin),
      escapeCSV(row.social.tiktok),
      escapeCSV(row.social.youtube),
      escapeCSV(row.social.x),
      escapeCSV(row.social.website),
      escapeCSV(row.last_crawled_at),
      escapeCSV(row.crawl_status),
      escapeCSV(row.pages_visited),
    ];
    lines.push(values.join(','));
  }

  // Add BOM for UTF-8 (Excel compatibility)
  const csv = lines.join('\n');
  return '\ufeff' + csv; // UTF-8 BOM
}

/**
 * Convert ExportRowV1 to XLSX format
 */
export async function exportRowV1ToXLSX(
  rows: ExportRowV1[],
  watermark?: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Export');

  // Define columns
  worksheet.columns = [
    { header: 'Dataset ID', key: 'dataset_id', width: 40 },
    { header: 'Business ID', key: 'business_id', width: 20 },
    { header: 'Business Name', key: 'business_name', width: 30 },
    { header: 'Business Address', key: 'business_address', width: 40 },
    { header: 'City', key: 'city', width: 20 },
    { header: 'Industry', key: 'industry', width: 20 },
    { header: 'Website URL', key: 'website_url', width: 40 },
    { header: 'Emails', key: 'emails', width: 40 },
    { header: 'Phones', key: 'phones', width: 30 },
    { header: 'Facebook', key: 'social_facebook', width: 40 },
    { header: 'Instagram', key: 'social_instagram', width: 40 },
    { header: 'LinkedIn', key: 'social_linkedin', width: 40 },
    { header: 'TikTok', key: 'social_tiktok', width: 40 },
    { header: 'YouTube', key: 'social_youtube', width: 40 },
    { header: 'X (Twitter)', key: 'social_x', width: 40 },
    { header: 'Social Website', key: 'social_website', width: 40 },
    { header: 'Last Crawled At', key: 'last_crawled_at', width: 25 },
    { header: 'Crawl Status', key: 'crawl_status', width: 15 },
    { header: 'Pages Visited', key: 'pages_visited', width: 15 },
  ];

  // Header styling
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  // Data rows
  for (const row of rows) {
    worksheet.addRow({
      dataset_id: row.dataset_id,
      business_id: row.business_id,
      business_name: row.business_name,
      business_address: row.business_address || '',
      city: row.city,
      industry: row.industry || '',
      website_url: row.website_url || '',
      emails: row.emails.join('; '),
      phones: row.phones.join('; '),
      social_facebook: row.social.facebook || '',
      social_instagram: row.social.instagram || '',
      social_linkedin: row.social.linkedin || '',
      social_tiktok: row.social.tiktok || '',
      social_youtube: row.social.youtube || '',
      social_x: row.social.x || '',
      social_website: row.social.website || '',
      last_crawled_at: row.last_crawled_at || '',
      crawl_status: row.crawl_status,
      pages_visited: row.pages_visited,
    });
  }

  // Optional watermark/footer row
  if (watermark) {
    const footerRow = worksheet.addRow([watermark]);
    footerRow.getCell(1).font = { italic: true, color: { argb: 'FF808080' } };
    footerRow.getCell(1).alignment = {
      horizontal: 'left',
      vertical: 'middle',
    };
    worksheet.mergeCells(
      footerRow.number,
      1,
      footerRow.number,
      worksheet.columnCount
    );
  }

  workbook.creator = 'Leads Generation Export Worker';
  workbook.created = new Date();
  workbook.modified = new Date();

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
