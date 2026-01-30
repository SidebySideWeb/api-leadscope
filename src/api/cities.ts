import express from 'express';
import { pool } from '../config/database.js';
import type { City } from '../types/index.js';

const router = express.Router();

/**
 * GET /api/cities
 * Get all cities, optionally filtered by country (public endpoint - no auth required)
 */
router.get('/', async (req, res) => {
  try {
    const countryCode = req.query.country as string | undefined;

    let query = `
      SELECT 
        c.id,
        c.name,
        c.latitude,
        c.longitude,
        co.code as country
      FROM cities c
      LEFT JOIN countries co ON co.id = c.country_id
    `;
    const params: any[] = [];

    if (countryCode) {
      query += ' WHERE co.code = $1';
      params.push(countryCode);
    }

    query += ' ORDER BY c.name ASC';

    const result = await pool.query<{
      id: number;
      name: string;
      country: string | null;
      latitude: number | null;
      longitude: number | null;
    }>(query, params.length > 0 ? params : undefined);

    const cities = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      country: row.country || 'GR',
      latitude: row.latitude,
      longitude: row.longitude,
    }));

    res.json({
      data: cities,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: cities.length,
        total_returned: cities.length,
      },
    });
  } catch (error) {
    console.error('[API] Error fetching cities:', error);
    res.status(500).json({
      data: [],
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: 'Failed to fetch cities',
      },
    });
  }
});

export default router;
