/**
 * POST /export endpoint
 * Exports businesses to Excel with pricing calculation
 * Max export: 1000 rows
 * Pricing: Based on (end_row - start_row)
 */

import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import ExcelJS from 'exceljs';
import { verifyDatasetOwnership } from '../db/datasets.js';

const router = express.Router();

/**
 * Calculate export cost based on row range
 * Cost = (end_row - start_row) * price_per_row
 */
function calculateExportCost(startRow: number, endRow: number, pricePerRow: number = 0.01): number {
  const rowCount = endRow - startRow;
  return rowCount * pricePerRow;
}

/**
 * POST /export
 * Export businesses to Excel file
 * Body: { municipality_id?, industry_id?, prefecture_id?, start_row, end_row }
 */
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { municipality_id, industry_id, prefecture_id, start_row, end_row } = req.body;

    // Validate required fields
    if (start_row === undefined || end_row === undefined) {
      return res.status(400).json({
        error: 'start_row and end_row are required',
      });
    }

    const startRow = parseInt(start_row, 10);
    const endRow = parseInt(end_row, 10);

    // Validate row range
    if (isNaN(startRow) || isNaN(endRow) || startRow < 0 || endRow < 0) {
      return res.status(400).json({
        error: 'start_row and end_row must be valid positive numbers',
      });
    }

    if (startRow >= endRow) {
      return res.status(400).json({
        error: 'start_row must be less than end_row',
      });
    }

    const rowCount = endRow - startRow;

    // Max export limit: 1000 rows
    if (rowCount > 1000) {
      return res.status(400).json({
        error: `Export limit exceeded. Maximum 1000 rows allowed, requested ${rowCount} rows`,
      });
    }

    // Calculate pricing
    const pricePerRow = parseFloat(process.env.EXPORT_PRICE_PER_ROW || '0.01');
    const cost = calculateExportCost(startRow, endRow, pricePerRow);

    // Build query with filters
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (municipality_id) {
      conditions.push(`b.municipality_id = $${paramIndex}`);
      params.push(municipality_id);
      paramIndex++;
    }

    // Filter by industry through dataset (industry_id column removed from businesses table)
    if (industry_id) {
      conditions.push(`b.dataset_id IN (SELECT id FROM datasets WHERE industry_id = $${paramIndex})`);
      params.push(industry_id);
      paramIndex++;
    }

    if (prefecture_id) {
      conditions.push(`b.prefecture_id = $${paramIndex}`);
      params.push(prefecture_id);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get businesses with pagination (industry_id and city_id columns removed)
    // Include phone, email, and website_url directly from businesses table
    const query = `
      SELECT 
        b.id,
        b.name,
        b.address,
        b.postal_code,
        b.ar_gemi,
        b.website_url,
        b.phone,
        b.email,
        COALESCE(m.descr_en, m.descr) as municipality_name,
        COALESCE(p.descr_en, p.descr) as prefecture_name,
        i.name as industry_name
      FROM businesses b
      LEFT JOIN municipalities m ON m.id = b.municipality_id
      LEFT JOIN prefectures p ON p.id = b.prefecture_id
      LEFT JOIN datasets d ON d.id = b.dataset_id
      LEFT JOIN industries i ON i.id = d.industry_id
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(rowCount, startRow);

    const result = await pool.query(query, params);

    // Get contacts for businesses
    const businessIds = result.rows.map((b: any) => b.id);
    const contactsMap = new Map<string, { emails: string[]; phones: string[] }>();

    if (businessIds.length > 0) {
      const contactsResult = await pool.query<{
        business_id: string;
        email: string | null;
        phone: string | null;
      }>(
        `SELECT 
           cs.business_id,
           c.email,
           COALESCE(c.phone, c.mobile) as phone
         FROM contacts c
         JOIN contact_sources cs ON cs.contact_id = c.id
         WHERE cs.business_id = ANY($1)
           AND (c.email IS NOT NULL OR c.phone IS NOT NULL OR c.mobile IS NOT NULL)
         ORDER BY cs.business_id, cs.found_at ASC`,
        [businessIds]
      );

      contactsResult.rows.forEach((c) => {
        if (!contactsMap.has(c.business_id)) {
          contactsMap.set(c.business_id, { emails: [], phones: [] });
        }
        const contact = contactsMap.get(c.business_id)!;
        if (c.email && !contact.emails.includes(c.email)) {
          contact.emails.push(c.email);
        }
        if (c.phone && !contact.phones.includes(c.phone)) {
          contact.phones.push(c.phone);
        }
      });
    }

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Businesses');

    // Define columns
    worksheet.columns = [
      { header: 'AR GEMI', key: 'ar_gemi', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Address', key: 'address', width: 40 },
      { header: 'Postal Code', key: 'postal_code', width: 12 },
      { header: 'Municipality', key: 'municipality', width: 20 },
      { header: 'Prefecture', key: 'prefecture', width: 20 },
      { header: 'Industry', key: 'industry', width: 25 },
      { header: 'Website', key: 'website', width: 30 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data rows - phone, email, and website_url are directly on businesses table
    result.rows.forEach((business: any) => {
      worksheet.addRow({
        ar_gemi: business.ar_gemi || '',
        name: business.name || '',
        address: business.address || '',
        postal_code: business.postal_code || '',
        municipality: business.municipality_name || '',
        prefecture: business.prefecture_name || '',
        industry: business.industry_name || '',
        website: business.website_url || '',
        email: business.email || '',
        phone: business.phone || '',
      });
    });

    // Generate Excel buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Set response headers
    const filename = `businesses_export_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Cost', cost.toFixed(4));
    res.setHeader('X-Export-Rows', rowCount.toString());

    // Send file
    return res.send(Buffer.from(buffer));
  } catch (error: any) {
    console.error('[API] Error in export:', error);
    return res.status(500).json({
      error: error.message || 'Failed to export businesses',
    });
  }
});

export default router;
