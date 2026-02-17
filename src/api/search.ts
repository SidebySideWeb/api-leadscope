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
    const { 
      municipality_id, 
      municipality_ids,
      industry_id, 
      industry_ids,
      prefecture_id, 
      prefecture_ids,
      page = '1', 
      limit = '50' 
    } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100); // Max 100 per page
    const offset = (pageNum - 1) * limitNum;

    // Build query
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Filter by municipality (support both single and array)
    const municipalityIds: string[] = [];
    if (municipality_id) {
      municipalityIds.push(municipality_id as string);
    }
    if (municipality_ids) {
      const ids = Array.isArray(municipality_ids) ? municipality_ids : [municipality_ids];
      municipalityIds.push(...ids.map(id => String(id)));
    }
    if (municipalityIds.length > 0) {
      conditions.push(`b.municipality_id = ANY($${paramIndex}::uuid[])`);
      params.push(municipalityIds);
      paramIndex++;
    }

    // Filter by industry through dataset (support both single and array)
    const industryIds: string[] = [];
    if (industry_id) {
      industryIds.push(industry_id as string);
    }
    if (industry_ids) {
      const ids = Array.isArray(industry_ids) ? industry_ids : [industry_ids];
      industryIds.push(...ids.map(id => String(id)));
    }
    if (industryIds.length > 0) {
      conditions.push(`b.dataset_id IN (SELECT id FROM datasets WHERE industry_id = ANY($${paramIndex}::uuid[]))`);
      params.push(industryIds);
      paramIndex++;
    }

    // Filter by prefecture (support both single and array)
    const prefectureIds: string[] = [];
    if (prefecture_id) {
      prefectureIds.push(prefecture_id as string);
    }
    if (prefecture_ids) {
      const ids = Array.isArray(prefecture_ids) ? prefecture_ids : [prefecture_ids];
      prefectureIds.push(...ids.map(id => String(id)));
    }
    if (prefectureIds.length > 0) {
      conditions.push(`b.prefecture_id = ANY($${paramIndex}::uuid[])`);
      params.push(prefectureIds);
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

    // Get businesses with pagination (industry_id and city_id columns removed)
    // Include phone, email, and website_url directly from businesses table
    const query = `
      SELECT 
        b.id,
        b.name,
        b.address,
        b.postal_code,
        b.ar_gemi,
        b.municipality_id,
        b.prefecture_id,
        b.website_url,
        b.phone,
        b.email,
        b.dataset_id,
        b.created_at,
        b.updated_at,
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
    params.push(limitNum, offset);

    const result = await pool.query(query, params);

    // Format response - phone, email, and website_url are now directly on businesses table
    const businesses = result.rows.map((b: any) => {
      return {
        id: b.id,
        name: b.name,
        address: b.address,
        postal_code: b.postal_code,
        ar_gemi: b.ar_gemi,
        municipality: b.municipality_name,
        prefecture: b.prefecture_name,
        industry: b.industry_name,
        website: b.website_url || null,
        email: b.email || null,
        phone: b.phone || null,
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
