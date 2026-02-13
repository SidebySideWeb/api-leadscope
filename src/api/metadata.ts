/**
 * Metadata API Endpoints
 * Provides access to prefectures, municipalities, and industries from GEMI data
 */

import { Router, Request, Response } from 'express';
import { pool } from '../config/database.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/metadata/prefectures
 * Get all prefectures (regions)
 */
router.get('/prefectures', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, gemi_id, descr, descr_en, last_updated_api, created_at
       FROM prefectures
       ORDER BY descr_en ASC, descr ASC`
    );

    return res.json({
      data: result.rows,
      meta: {
        plan_id: 'demo', // TODO: Get from user permissions
        gated: false,
        total_available: result.rows.length,
        total_returned: result.rows.length,
      },
    });
  } catch (error: any) {
    console.error('[Metadata] Error fetching prefectures:', error);
    return res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch prefectures',
      },
    });
  }
});

/**
 * GET /api/metadata/municipalities
 * Get municipalities, optionally filtered by prefecture_id
 * Query params: prefecture_id (optional)
 */
router.get('/municipalities', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { prefecture_id } = req.query;

    let query = `
      SELECT id, gemi_id, prefecture_id, descr, descr_en, last_updated_api, created_at
      FROM municipalities
    `;
    const params: any[] = [];

    if (prefecture_id) {
      query += ' WHERE prefecture_id = $1';
      params.push(prefecture_id);
    }

    query += ' ORDER BY descr_en ASC, descr ASC';

    const result = await pool.query(query, params);

    return res.json({
      data: result.rows,
      meta: {
        plan_id: 'demo', // TODO: Get from user permissions
        gated: false,
        total_available: result.rows.length,
        total_returned: result.rows.length,
      },
    });
  } catch (error: any) {
    console.error('[Metadata] Error fetching municipalities:', error);
    return res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch municipalities',
      },
    });
  }
});

/**
 * GET /api/metadata/industries
 * Get all industries (reuses existing industries endpoint structure)
 */
router.get('/industries', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, gemi_id, name, created_at, updated_at, is_active
       FROM industries
       WHERE is_active = true
       ORDER BY name ASC`
    );

    return res.json({
      data: result.rows,
      meta: {
        plan_id: 'demo', // TODO: Get from user permissions
        gated: false,
        total_available: result.rows.length,
        total_returned: result.rows.length,
      },
    });
  } catch (error: any) {
    console.error('[Metadata] Error fetching industries:', error);
    return res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch industries',
      },
    });
  }
});

export default router;
