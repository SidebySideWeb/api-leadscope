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

/**
 * GET /datasets/:id/results
 * Get businesses with crawl results for a dataset (must belong to user)
 */
router.get('/:id/results', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const datasetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    // Verify ownership
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

    // Get businesses with crawl results
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
      website_url: string | null;
      crawl_status: string | null;
      emails_count: number;
      phones_count: number;
      pages_visited: number;
      finished_at: Date | null;
    }>(
      `
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
        i.name as industry_name,
        w.url as website_url,
        CASE 
          WHEN cr.id IS NULL THEN 'not_crawled'
          WHEN cr.pages_crawled < 1 THEN 'not_crawled'
          WHEN cr.pages_crawled >= cr.pages_limit THEN 'completed'
          ELSE 'partial'
        END as crawl_status,
        COALESCE(contact_counts.emails_count, 0) as emails_count,
        COALESCE(contact_counts.phones_count, 0) as phones_count,
        COALESCE(cr.pages_crawled, 0) as pages_visited,
        cr.completed_at as finished_at
      FROM businesses b
      LEFT JOIN cities c ON c.id = b.city_id
      LEFT JOIN industries i ON i.id = b.industry_id
      LEFT JOIN websites w ON w.business_id = b.id
      LEFT JOIN crawl_results cr ON cr.business_id = b.id
      LEFT JOIN (
        SELECT 
          business_id,
          COUNT(*) FILTER (WHERE contact_type = 'email' AND is_active = true) as emails_count,
          COUNT(*) FILTER (WHERE contact_type IN ('phone', 'mobile') AND is_active = true) as phones_count
        FROM contacts
        GROUP BY business_id
      ) contact_counts ON contact_counts.business_id = b.id
      WHERE b.dataset_id = $1
      ORDER BY b.created_at DESC
      LIMIT 100
      `,
      [datasetId]
    );

    // Map to frontend format
    const businesses = result.rows.map((b) => ({
      id: b.id.toString(),
      name: b.name,
      address: b.address,
      website: b.website_url || null,
      email: null, // Individual emails are in contacts
      phone: null, // Individual phones are in contacts
      city: b.city_name || 'Unknown',
      industry: b.industry_name || 'Unknown',
      lastVerifiedAt: b.finished_at ? b.finished_at.toISOString() : null,
      isActive: true,
      crawl: {
        status: (b.crawl_status || 'not_crawled') as 'not_crawled' | 'partial' | 'completed',
        emailsCount: parseInt(b.emails_count.toString()) || 0,
        phonesCount: parseInt(b.phones_count.toString()) || 0,
        socialCount: 0, // Not tracked yet
        finishedAt: b.finished_at ? b.finished_at.toISOString() : null,
        pagesVisited: parseInt(b.pages_visited.toString()) || 0,
      },
    }));

    res.json({
      data: businesses,
      meta: {
        plan_id: 'demo', // Will be set from user's plan
        gated: false,
        total_available: businesses.length,
        total_returned: businesses.length,
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching dataset results:', error);
    res.status(500).json({
      data: [],
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch dataset results',
      },
    });
  }
});

export default router;
