import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import { getDatasetById, verifyDatasetOwnership } from '../db/datasets.js';
import { getIndustries } from '../db/industries.js';
import { getCities } from '../db/cities.js';
import type { Industry } from '../types/index.js';
import type { City } from '../types/index.js';

const router = express.Router();

/**
 * GET /datasets
 * Get all datasets for the authenticated user
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;

    // Get datasets with industry and city names
    const result = await pool.query<{
      id: string;
      user_id: string;
      name: string;
      city_id: number | null;
      industry_id: number | null;
      last_refreshed_at: Date | null;
      created_at: Date;
      businesses_count: number;
      contacts_count: number;
    }>(
      `
      SELECT 
        d.id,
        d.user_id,
        d.name,
        d.city_id,
        d.industry_id,
        d.last_refreshed_at,
        d.created_at,
        COUNT(DISTINCT b.id) as businesses_count,
        COUNT(DISTINCT c.id) as contacts_count
      FROM datasets d
      LEFT JOIN businesses b ON b.dataset_id = d.id
      LEFT JOIN contacts c ON c.business_id = b.id
      WHERE d.user_id = $1
      GROUP BY d.id
      ORDER BY d.created_at DESC
      `,
      [userId]
    );

    // Get industries and cities for name mapping
    const [industries, cities] = await Promise.all([
      getIndustries(),
      getCities(),
    ]);

    const industryMap = new Map(industries.map((i: Industry) => [i.id, i.name]));
    const cityMap = new Map(cities.map((c: City) => [c.id, c.name]));

    const datasets = result.rows.map(row => {
      const now = new Date();
      const lastRefresh = row.last_refreshed_at ? new Date(row.last_refreshed_at) : null;
      const daysSinceRefresh = lastRefresh 
        ? Math.floor((now.getTime() - lastRefresh.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      // Determine refresh status
      let refreshStatus: 'snapshot' | 'refreshing' | 'outdated' = 'snapshot';
      if (lastRefresh) {
        if (daysSinceRefresh! > 30) {
          refreshStatus = 'outdated';
        } else {
          refreshStatus = 'refreshing';
        }
      }

      return {
        id: row.id,
        name: row.name,
        industry: row.industry_id ? industryMap.get(row.industry_id) || 'Unknown' : 'Unknown',
        city: row.city_id ? cityMap.get(row.city_id) || 'Unknown' : 'Unknown',
        businesses: parseInt(row.businesses_count.toString()) || 0,
        contacts: parseInt(row.contacts_count.toString()) || 0,
        createdAt: row.created_at.toISOString(),
        refreshStatus,
        lastRefresh: lastRefresh ? lastRefresh.toISOString() : null,
      };
    });

    res.json({
      data: datasets,
      meta: {
        plan_id: 'demo', // Will be set from user's plan
        gated: false,
        total_available: datasets.length,
        total_returned: datasets.length,
      },
    });
  } catch (error) {
    console.error('[API] Error fetching datasets:', error);
    res.status(500).json({ error: 'Failed to fetch datasets' });
  }
});

/**
 * GET /datasets/:id
 * Get a single dataset by ID (must belong to user)
 */
router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const datasetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    // Verify ownership
    const ownsDataset = await verifyDatasetOwnership(datasetId, userId);
    if (!ownsDataset) {
      res.status(403).json({ error: 'Dataset not found or access denied' });
      return;
    }

    const dataset = await getDatasetById(datasetId);
    if (!dataset) {
      res.status(404).json({ error: 'Dataset not found' });
      return;
    }

    // Get counts
    const countsResult = await pool.query<{
      businesses_count: number;
      contacts_count: number;
    }>(
      `
      SELECT 
        COUNT(DISTINCT b.id) as businesses_count,
        COUNT(DISTINCT c.id) as contacts_count
      FROM businesses b
      LEFT JOIN contacts c ON c.business_id = b.id
      WHERE b.dataset_id = $1
      `,
      [datasetId]
    );

    const counts = countsResult.rows[0] || { businesses_count: 0, contacts_count: 0 };

    // Get industry and city names
    const [industries, cities] = await Promise.all([
      getIndustries(),
      getCities(),
    ]);

    const industry = dataset.industry_id 
      ? industries.find((i: Industry) => i.id === dataset.industry_id)?.name || 'Unknown'
      : 'Unknown';
    const city = dataset.city_id
      ? cities.find((c: City) => c.id === dataset.city_id)?.name || 'Unknown'
      : 'Unknown';

    const lastRefresh = dataset.last_refreshed_at ? new Date(dataset.last_refreshed_at) : null;
    const now = new Date();
    const daysSinceRefresh = lastRefresh 
      ? Math.floor((now.getTime() - lastRefresh.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    let refreshStatus: 'snapshot' | 'refreshing' | 'outdated' = 'snapshot';
    if (lastRefresh) {
      if (daysSinceRefresh! > 30) {
        refreshStatus = 'outdated';
      } else {
        refreshStatus = 'refreshing';
      }
    }

    res.json({
      data: {
        id: dataset.id,
        name: dataset.name,
        industry,
        city,
        businesses: parseInt(counts.businesses_count.toString()) || 0,
        contacts: parseInt(counts.contacts_count.toString()) || 0,
        createdAt: dataset.created_at.toISOString(),
        refreshStatus,
        lastRefresh: lastRefresh ? lastRefresh.toISOString() : null,
      },
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 1,
        total_returned: 1,
      },
    });
  } catch (error) {
    console.error('[API] Error fetching dataset:', error);
    res.status(500).json({ error: 'Failed to fetch dataset' });
  }
});

export default router;
