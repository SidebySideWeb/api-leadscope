import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import { verifyDatasetOwnership } from '../db/datasets.js';

const router = express.Router();

/**
 * GET /businesses
 * Get businesses for a dataset (must belong to authenticated user)
 * Query params: datasetId (required), page, limit, search
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const datasetId = req.query.datasetId as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = req.query.search as string | undefined;

    if (!datasetId) {
      return res.status(400).json({
        data: [],
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'datasetId is required',
        },
      });
    }

    // Verify dataset ownership
    const ownsDataset = await verifyDatasetOwnership(datasetId, userId);
    if (!ownsDataset) {
      return res.status(403).json({
        data: [],
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Dataset not found or access denied',
        },
      });
    }

    // Build query
    let query = `
      SELECT 
        b.id,
        b.name,
        b.address,
        b.postal_code,
        b.city_id,
        b.industry_id,
        b.google_place_id,
        b.dataset_id,
        b.owner_user_id,
        b.created_at,
        b.updated_at,
        c.name as city_name,
        i.name as industry_name
      FROM businesses b
      LEFT JOIN cities c ON c.id = b.city_id
      LEFT JOIN industries i ON i.id = b.industry_id
      WHERE b.dataset_id = $1
    `;
    const params: any[] = [datasetId];

    // Add search filter if provided
    if (search) {
      query += ' AND (b.name ILIKE $2 OR b.address ILIKE $2)';
      params.push(`%${search}%`);
    }

    // Get total count
    const countQuery = query.replace(
      'SELECT b.id, b.name, b.address, b.postal_code, b.city_id, b.industry_id, b.google_place_id, b.dataset_id, b.owner_user_id, b.created_at, b.updated_at, c.name as city_name, i.name as industry_name',
      'SELECT COUNT(*) as total'
    );
    const countResult = await pool.query<{ total: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    // Add pagination
    const offset = (page - 1) * limit;
    query += ` ORDER BY b.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    // Execute query
    const result = await pool.query<{
      id: number;
      name: string;
      address: string | null;
      postal_code: string | null;
      city_id: number;
      industry_id: number | null;
      google_place_id: string | null;
      dataset_id: string;
      owner_user_id: string;
      created_at: Date;
      updated_at: Date;
      city_name: string | null;
      industry_name: string | null;
    }>(query, params);

    // Get websites for businesses (to populate website field)
    const businessIds = result.rows.map(b => b.id);
    let websites: { business_id: number; url: string }[] = [];
    
    if (businessIds.length > 0) {
      const websitesResult = await pool.query<{ business_id: number; url: string }>(
        `SELECT business_id, url FROM websites WHERE business_id = ANY($1)`,
        [businessIds]
      );
      websites = websitesResult.rows;
    }

    const websiteMap = new Map(websites.map(w => [w.business_id, w.url]));

    // Map to frontend format
    const businesses = result.rows.map((b) => ({
      id: b.id.toString(),
      name: b.name,
      address: b.address,
      website: websiteMap.get(b.id) || null,
      email: null, // Will be populated from contacts
      phone: null, // Will be populated from contacts
      city: b.city_name || 'Unknown',
      industry: b.industry_name || 'Unknown',
      lastVerifiedAt: null,
      isActive: true,
    }));

    res.json({
      data: businesses,
      meta: {
        plan_id: 'demo', // Will be set from user's plan
        gated: false,
        total_available: total,
        total_returned: businesses.length,
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching businesses:', error);
    res.status(500).json({
      data: [],
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch businesses',
      },
    });
  }
});

export default router;
