import ExcelJS from 'exceljs';
import type { ExportRow } from '../types/exports.js';
import { generateFooterText } from './watermark.js';
import type { ExportType } from '../types/exports.js';

/**
 * Build Excel file with watermarking and anti-churn mechanisms
 */
export async function buildExcelFile(
  rows: ExportRow[],
  exportType: ExportType
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Business Contacts');

  // Set column headers
  worksheet.columns = [
    { header: 'Company Name', key: 'company_name', width: 30 },
    { header: 'Industry', key: 'industry', width: 20 },
    { header: 'City', key: 'city', width: 20 },
    { header: 'Address', key: 'address', width: 40 },
    { header: 'Website', key: 'website', width: 30 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Phone', key: 'phone', width: 20 },
    { header: 'Mobile', key: 'mobile', width: 20 },
    { header: 'Source URL', key: 'source_url', width: 50 },
    { header: 'First Seen At', key: 'first_seen_at', width: 20 },
    { header: 'Last Verified At', key: 'last_verified_at', width: 20 },
    { header: 'Contact Status', key: 'contact_status', width: 15 }
  ];

  // Style header row
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };

  // Add data rows
  rows.forEach((row) => {
    worksheet.addRow({
      company_name: row.company_name,
      industry: row.industry,
      city: row.city,
      address: row.address || '',
      website: row.website || '',
      email: row.email || '',
      phone: row.phone || '',
      mobile: row.mobile || '',
      source_url: row.source_url,
      first_seen_at: row.first_seen_at.toISOString().split('T')[0],
      last_verified_at: row.last_verified_at.toISOString().split('T')[0],
      contact_status: row.contact_status
    });
  });

  // Add footer row with watermark
  const footerRow = worksheet.addRow([generateFooterText(exportType)]);
  footerRow.getCell(1).font = { italic: true, color: { argb: 'FF808080' } };
  footerRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  worksheet.mergeCells(footerRow.number, 1, footerRow.number, worksheet.columnCount);

  // Add watermark to metadata
  workbook.creator = 'Business Intelligence Pro';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
