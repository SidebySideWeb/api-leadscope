import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import { getUserUsage } from '../persistence/index.js';

const router = express.Router();

/**
 * GET /dashboard/metrics
 * Get dashboard metrics for the authenticated user
 */
router.get('/metrics', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;

    // Get total businesses across all user's datasets
    const businessesResult = await pool.query<{ count: number }>(
      `
      SELECT COUNT(DISTINCT b.id) as count
      FROM businesses b
      INNER JOIN datasets d ON d.id = b.dataset_id
      WHERE d.user_id = $1
      `,
      [userId]
    );
    const businesses_total = parseInt(businessesResult.rows[0]?.count.toString() || '0');

    // Get businesses that have been crawled (at least one crawl_page)
    const crawledResult = await pool.query<{ count: number }>(
      `
      SELECT COUNT(DISTINCT b.id) as count
      FROM businesses b
      INNER JOIN datasets d ON d.id = b.dataset_id
      INNER JOIN websites w ON w.business_id = b.id
      INNER JOIN crawl_jobs cj ON cj.website_id = w.id
      INNER JOIN crawl_pages cp ON cp.crawl_job_id = cj.id
      WHERE d.user_id = $1
      `,
      [userId]
    );
    const businesses_crawled = parseInt(crawledResult.rows[0]?.count.toString() || '0');

    // Get total contacts found (via contact_sources linking contacts to businesses)
    const contactsResult = await pool.query<{ count: number }>(
      `
      SELECT COUNT(DISTINCT c.id) as count
      FROM contact_sources cs
      INNER JOIN contacts c ON c.id = cs.contact_id
      INNER JOIN businesses b ON b.id = cs.business_id
      INNER JOIN datasets d ON d.id = b.dataset_id
      WHERE d.user_id = $1
        AND c.is_active = TRUE
      `,
      [userId]
    );
    const contacts_found = parseInt(contactsResult.rows[0]?.count.toString() || '0');

    // Get exports this month
    const usage = await getUserUsage(userId);
    const exports_this_month = usage.exports_this_month || 0;

    // Get unique cities scanned
    const citiesResult = await pool.query<{ count: number }>(
      `
      SELECT COUNT(DISTINCT d.city_id) as count
      FROM datasets d
      WHERE d.user_id = $1 AND d.city_id IS NOT NULL
      `,
      [userId]
    );
    const cities_scanned = parseInt(citiesResult.rows[0]?.count.toString() || '0');

    // Get last refresh time
    const lastRefreshResult = await pool.query<{ last_refreshed_at: Date | null }>(
      `
      SELECT MAX(last_refreshed_at) as last_refreshed_at
      FROM datasets
      WHERE user_id = $1
      `,
      [userId]
    );
    const last_refresh = lastRefreshResult.rows[0]?.last_refreshed_at 
      ? new Date(lastRefreshResult.rows[0].last_refreshed_at).toISOString()
      : null;

    res.json({
      data: {
        businesses_total,
        businesses_crawled,
        contacts_found,
        exports_this_month,
        cities_scanned,
        last_refresh,
      },
      meta: {
        plan_id: 'demo', // Will be set from user's plan
        gated: false,
        total_available: 1,
        total_returned: 1,
      },
    });
  } catch (error) {
    console.error('[API] Error fetching dashboard metrics:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
  }
});

export default router;
