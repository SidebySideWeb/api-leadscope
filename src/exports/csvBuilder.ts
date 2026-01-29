// CSV building without external library for simplicity
// In production, you might want to use csv-stringify
import type { ExportRow } from '../types/exports.js';
import { generateFooterText } from './watermark.js';
import type { ExportType } from '../types/exports.js';

/**
 * Build CSV file with watermarking
 */
export function buildCsvFile(
  rows: ExportRow[],
  exportType: ExportType
): string {
  // CSV headers
  const headers = [
    'Company Name',
    'Industry',
    'City',
    'Address',
    'Website',
    'Email',
    'Phone',
    'Mobile',
    'Source URL',
    'First Seen At',
    'Last Verified At',
    'Contact Status'
  ];

  // Escape CSV values
  const escapeCsv = (value: any): string => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Convert rows to CSV format
  const csvRows = rows.map((row) => [
    escapeCsv(row.company_name),
    escapeCsv(row.industry),
    escapeCsv(row.city),
    escapeCsv(row.address),
    escapeCsv(row.website),
    escapeCsv(row.email),
    escapeCsv(row.phone),
    escapeCsv(row.mobile),
    escapeCsv(row.source_url),
    escapeCsv(row.first_seen_at.toISOString().split('T')[0]),
    escapeCsv(row.last_verified_at.toISOString().split('T')[0]),
    escapeCsv(row.contact_status)
  ]);

  // Generate CSV
  const csv = [
    headers.map(escapeCsv).join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');

  // Add footer watermark
  const footer = `\n\n${generateFooterText(exportType)}`;

  return csv + footer;
}
