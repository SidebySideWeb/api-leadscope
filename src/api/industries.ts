import express from 'express';
import { pool } from '../config/database.js';
import type { Industry } from '../types/index.js';

const router = express.Router();

/**
 * GET /api/industries
 * Get all industries (public endpoint - no auth required)
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query<Industry>(
      'SELECT id, name FROM industries ORDER BY name ASC'
    );

    res.json({
      data: result.rows,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: result.rows.length,
        total_returned: result.rows.length,
      },
    });
  } catch (error) {
    console.error('[API] Error fetching industries:', error);
    res.status(500).json({
      data: [],
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: 'Failed to fetch industries',
      },
    });
  }
});

export default router;
