/**
 * GET /search endpoint
 * Searches businesses in local Supabase database
 * Criteria: municipality_id, industry_id, prefecture_id
 */

import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';

const router = express.Router();

/**
 * GET /search
 * Search businesses by municipality, industry, and/or prefecture
 * Query params: municipality_id, industry_id, prefecture_id, page, limit
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { municipality_id, industry_id, prefecture_id, page = '1', limit = '50' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100); // Max 100 per page
    const offset = (pageNum - 1) * limitNum;

    // Build query
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Filter by municipality
    if (municipality_id) {
      conditions.push(`b.municipality_id = $${paramIndex}`);
      params.push(municipality_id);
      paramIndex++;
    }

    // Filter by industry
    if (industry_id) {
      conditions.push(`b.industry_id = $${paramIndex}`);
      params.push(industry_id);
      paramIndex++;
    }

    // Filter by prefecture
    if (prefecture_id) {
      conditions.push(`b.prefecture_id = $${paramIndex}`);
      params.push(prefecture_id);
      paramIndex++;
    }

    // Build WHERE clause
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM businesses b
      ${whereClause}
    `;
    const countResult = await pool.query<{ total: string }>(countQuery, params);
    const totalCount = parseInt(countResult.rows[0]?.total || '0', 10);

    // Get businesses with pagination
    const query = `
      SELECT 
        b.id,
        b.name,
        b.address,
        b.postal_code,
        b.ar_gemi,
        b.municipality_id,
        b.prefecture_id,
        b.industry_id,
        b.website_url,
        b.created_at,
        b.updated_at,
        m.name as municipality_name,
        p.name as prefecture_name,
        i.name as industry_name,
        c.name as city_name
      FROM businesses b
      LEFT JOIN municipalities m ON m.id = b.municipality_id
      LEFT JOIN prefectures p ON p.id = b.prefecture_id
      LEFT JOIN industries i ON i.id = b.industry_id
      LEFT JOIN cities c ON c.id = b.city_id
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limitNum, offset);

    const result = await pool.query(query, params);

    // Get websites and contacts for businesses
    const businessIds = result.rows.map((b: any) => b.id);
    const websitesMap = new Map<string, string>();
    const contactsMap = new Map<string, { email: string | null; phone: string | null }>();

    if (businessIds.length > 0) {
      // Get websites
      const websitesResult = await pool.query<{ business_id: string; url: string }>(
        'SELECT business_id, url FROM websites WHERE business_id = ANY($1)',
        [businessIds]
      );
      websitesResult.rows.forEach((w) => {
        websitesMap.set(w.business_id, w.url);
      });

      // Get contacts
      const contactsResult = await pool.query<{
        business_id: string;
        email: string | null;
        phone: string | null;
      }>(
        `SELECT DISTINCT ON (cs.business_id, c.contact_type)
           cs.business_id,
           CASE WHEN c.contact_type = 'email' THEN c.email ELSE NULL END as email,
           CASE WHEN c.contact_type = 'phone' THEN COALESCE(c.phone, c.mobile) ELSE NULL END as phone
         FROM contacts c
         JOIN contact_sources cs ON cs.contact_id = c.id
         WHERE cs.business_id = ANY($1)
           AND (c.email IS NOT NULL OR c.phone IS NOT NULL OR c.mobile IS NOT NULL)
         ORDER BY cs.business_id, c.contact_type, cs.found_at ASC`,
        [businessIds]
      );

      contactsResult.rows.forEach((c) => {
        if (!contactsMap.has(c.business_id)) {
          contactsMap.set(c.business_id, { email: null, phone: null });
        }
        const contact = contactsMap.get(c.business_id)!;
        if (c.email && !contact.email) contact.email = c.email;
        if (c.phone && !contact.phone) contact.phone = c.phone;
      });
    }

    // Format response
    const businesses = result.rows.map((b: any) => {
      const contact = contactsMap.get(b.id) || { email: null, phone: null };
      return {
        id: b.id,
        name: b.name,
        address: b.address,
        postal_code: b.postal_code,
        ar_gemi: b.ar_gemi,
        municipality: b.municipality_name,
        prefecture: b.prefecture_name,
        industry: b.industry_name,
        city: b.city_name,
        website: websitesMap.get(b.id) || b.website_url || null,
        email: contact.email,
        phone: contact.phone,
        created_at: b.created_at instanceof Date ? b.created_at.toISOString() : b.created_at,
        updated_at: b.updated_at instanceof Date ? b.updated_at.toISOString() : b.updated_at,
      };
    });

    return res.json({
      data: businesses,
      meta: {
        total_count: totalCount,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (error: any) {
    console.error('[API] Error in search:', error);
    return res.status(500).json({
      data: [],
      meta: {
        total_count: 0,
        error: error.message || 'Failed to search businesses',
      },
    });
  }
});

export default router;
