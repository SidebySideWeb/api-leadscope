import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import { getDatasetById, verifyDatasetOwnership } from '../db/datasets.js';
import { getIndustries } from '../db/industries.js';
// Note: cities table may not exist, so getCities() is not imported
import type { Industry } from '../types/index.js';

const router = express.Router();

/**
 * GET /datasets
 * Get all datasets for the authenticated user
 */
router.get('/', authMiddleware, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    console.log('[datasets] Fetching datasets for user:', userId);
    console.log('[datasets] User ID type:', typeof userId);
    console.log('[datasets] User ID length:', userId?.length);
    console.log('[datasets] User object:', req.user);
    console.log('[datasets] Request headers:', {
      cookie: req.headers.cookie ? 'present' : 'missing',
      authorization: req.headers.authorization ? 'present' : 'missing',
    });
    
    // Verify user ID is valid
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      console.error('[datasets] Invalid user ID:', userId);
      res.status(401).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Invalid user ID',
        },
      });
      return;
    }

    // Get datasets with industry and city names
    // Note: city_id and industry_id might be INTEGER or UUID depending on schema
    // Cast to text to handle both cases
    console.log('[datasets] Executing query with userId:', userId);
    
    // First, check if contacts table exists
    let contactsTableExists = false;
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'contacts'
        )
      `);
      contactsTableExists = tableCheck.rows[0]?.exists || false;
      console.log('[datasets] Contacts table exists:', contactsTableExists);
    } catch (checkError: any) {
      console.warn('[datasets] Could not check if contacts table exists:', checkError.message);
    }

    let result;
    try {
      // Contacts are linked to businesses through contact_sources table, not directly
      // Check if contact_sources table exists
      let contactSourcesTableExists = false;
      try {
        const csTableCheck = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'contact_sources'
          )
        `);
        contactSourcesTableExists = csTableCheck.rows[0]?.exists || false;
        console.log('[datasets] Contact_sources table exists:', contactSourcesTableExists);
      } catch (checkError: any) {
        console.warn('[datasets] Could not check if contact_sources table exists:', checkError.message);
      }

      // Use correct join through contact_sources if both tables exist
      const query = (contactsTableExists && contactSourcesTableExists)
        ? `
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
          LEFT JOIN contact_sources cs ON cs.business_id = b.id
          LEFT JOIN contacts c ON c.id = cs.contact_id
          WHERE d.user_id = $1
          GROUP BY d.id, d.user_id, d.name, d.city_id, d.industry_id, d.last_refreshed_at, d.created_at
          ORDER BY d.created_at DESC
        `
        : `
          SELECT 
            d.id,
            d.user_id,
            d.name,
            d.city_id,
            d.industry_id,
            d.last_refreshed_at,
            d.created_at,
            COUNT(DISTINCT b.id) as businesses_count,
            0 as contacts_count
          FROM datasets d
          LEFT JOIN businesses b ON b.dataset_id = d.id
          WHERE d.user_id = $1
          GROUP BY d.id, d.user_id, d.name, d.city_id, d.industry_id, d.last_refreshed_at, d.created_at
          ORDER BY d.created_at DESC
        `;

      result = await pool.query<{
        id: string;
        user_id: string;
        name: string;
        city_id: string | null;
        industry_id: string | null;
        last_refreshed_at: Date | null;
        created_at: Date;
        businesses_count: number;
        contacts_count: number;
      }>(query, [userId]);
    } catch (queryError: any) {
      console.error('[datasets] Query error:', {
        message: queryError.message,
        code: queryError.code,
        detail: queryError.detail,
        hint: queryError.hint,
        position: queryError.position,
        stack: queryError.stack,
      });
      throw queryError; // Re-throw to be caught by outer catch
    }

    console.log('[datasets] Query returned', result.rows.length, 'rows');
    if (result.rows.length > 0) {
      console.log('[datasets] Sample row:', {
        id: result.rows[0].id,
        user_id: result.rows[0].user_id,
        user_id_type: typeof result.rows[0].user_id,
        name: result.rows[0].name,
      });
    }

    // Get industries and cities for name mapping
    let industries: Industry[] = [];
    let cities: Array<{ id: string; name: string }> = [];
    try {
      industries = await getIndustries();
      // Note: cities table may not exist, so we skip getCities()
      console.log('[datasets] Loaded', industries.length, 'industries');
    } catch (lookupError: any) {
      console.error('[datasets] Error fetching industries/cities:', {
        message: lookupError.message,
        code: lookupError.code,
        detail: lookupError.detail,
      });
      // Continue with empty arrays - datasets will show 'Unknown' for industry/city
    }

    const industryMap = new Map(industries.map((i: Industry) => [i.id, i.name]));
    const cityMap = new Map(cities.map((c) => [c.id, c.name]));

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

      // Lookup industry and city names by UUID
      // All IDs are UUID, so direct map lookup works
      const industryName = row.industry_id 
        ? (industryMap.get(row.industry_id) || 'Unknown')
        : 'Unknown';
      
      const cityName = row.city_id 
        ? (cityMap.get(row.city_id) || 'Unknown')
        : 'Unknown';

      return {
        id: row.id,
        name: row.name,
        industry: industryName,
        city: cityName,
        businesses: parseInt(row.businesses_count.toString()) || 0,
        contacts: parseInt(row.contacts_count.toString()) || 0,
        createdAt: row.created_at.toISOString(),
        refreshStatus,
        lastRefresh: lastRefresh ? lastRefresh.toISOString() : null,
      };
    });

    console.log('[datasets] Found', datasets.length, 'datasets for user', userId);
    console.log('[datasets] Dataset IDs:', datasets.map(d => d.id));

    // Get user's plan from database
    let userPlan = 'demo';
    try {
      const userResult = await pool.query<{ plan: string }>(
        'SELECT plan FROM users WHERE id = $1',
        [userId]
      );
      userPlan = (userResult.rows[0]?.plan || 'demo') as string;
      console.log('[datasets] User plan:', userPlan);
    } catch (planError: any) {
      console.error('[datasets] Error fetching user plan:', {
        message: planError.message,
        code: planError.code,
        detail: planError.detail,
      });
      // Continue with default 'demo' plan if lookup fails
      console.log('[datasets] Using default plan: demo');
    }

    res.json({
      data: datasets,
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: datasets.length,
        total_returned: datasets.length,
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching datasets:', error);
    console.error('[API] Error message:', error.message);
    console.error('[API] Error code:', error.code);
    console.error('[API] Error detail:', error.detail);
    console.error('[API] Error hint:', error.hint);
    console.error('[API] Error stack:', error.stack);
    
    // Return detailed error in development, generic in production
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? 'Failed to fetch datasets'
      : `${error.message || 'Unknown error'}${error.detail ? `: ${error.detail}` : ''}${error.hint ? ` (${error.hint})` : ''}`;
    
    res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: errorMessage,
      },
    });
  }
});

/**
 * GET /datasets/:id
 * Get a single dataset by ID (must belong to user)
 */
router.get('/:id', authMiddleware, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const datasetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    // Verify ownership
    const ownsDataset = await verifyDatasetOwnership(datasetId, userId);
    if (!ownsDataset) {
      res.status(403).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Dataset not found or access denied',
        },
      });
      return;
    }

    const dataset = await getDatasetById(datasetId);
    if (!dataset) {
      res.status(404).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Dataset not found',
        },
      });
      return;
    }

    // Get counts
    // Contacts are linked through contact_sources, not directly
    const countsResult = await pool.query<{
      businesses_count: number;
      contacts_count: number;
    }>(
      `
      SELECT 
        COUNT(DISTINCT b.id) as businesses_count,
        COUNT(DISTINCT c.id) as contacts_count
      FROM businesses b
      LEFT JOIN contact_sources cs ON cs.business_id = b.id
      LEFT JOIN contacts c ON c.id = cs.contact_id
      WHERE b.dataset_id = $1
      `,
      [datasetId]
    );

    const counts = countsResult.rows[0];

    // Get industries and cities for name mapping
    const industries = await getIndustries();
    // Note: cities table may not exist, so we skip getCities()
    const cities: any[] = []; // Empty array since cities table doesn't exist

    // Direct UUID lookup - all IDs are UUID
    const industry = dataset.industry_id 
      ? (industries.find((i: Industry) => i.id === dataset.industry_id)?.name || 'Unknown')
      : 'Unknown';
    const city = dataset.city_id
      ? (cities.find((c) => c.id === dataset.city_id)?.name || 'Unknown')
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
  } catch (error: any) {
    console.error('[API] Error fetching dataset:', error);
    res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch dataset',
      },
    });
  }
});

/**
 * GET /datasets/:id/results
 * Get businesses with crawl results for a dataset (must belong to user)
 */
router.get('/:id/results', authMiddleware, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const datasetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    // Verify ownership
    const ownsDataset = await verifyDatasetOwnership(datasetId, userId);
    if (!ownsDataset) {
      res.status(403).json({
        data: [],
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Dataset not found or access denied',
        },
      });
      return;
    }

    // Get businesses with crawl results
    const result = await pool.query<{
      id: string;
      name: string;
      address: string | null;
      postal_code: string | null;
      dataset_id: string;
      owner_user_id: string;
      created_at: Date;
      updated_at: Date;
      city_id: string | null;
      industry_id: string | null;
      city_name: string | null;
      industry_name: string | null;
      website_url: string | null;
      phone: string | null;
      email: string | null;
      crawl_status: string | null;
      emails_count: number;
      phones_count: number;
      pages_visited: number;
      finished_at: Date | null;
    }>(
      `
      WITH crawl_stats AS (
        SELECT
          cj.business_id,
          COUNT(DISTINCT cp.id) AS pages_visited,
          MAX(cj.pages_limit) AS pages_limit,
          BOOL_OR(cj.status = 'success') AS any_completed,
          MAX(cj.finished_at) AS finished_at
        FROM crawl_jobs cj
        LEFT JOIN crawl_pages cp ON cp.crawl_job_id = cj.id
        WHERE cj.business_id IS NOT NULL
        GROUP BY cj.business_id
      ),
      contact_counts AS (
        SELECT
          cs.business_id,
          COUNT(DISTINCT c.id) FILTER (WHERE c.contact_type = 'email' AND c.is_active = TRUE) AS emails_count,
          COUNT(DISTINCT c.id) FILTER (WHERE c.contact_type IN ('phone','mobile') AND c.is_active = TRUE) AS phones_count
        FROM contact_sources cs
        JOIN contacts c ON c.id = cs.contact_id
        GROUP BY cs.business_id
      )
      SELECT 
        b.id,
        b.name,
        b.address,
        b.postal_code,
        b.dataset_id,
        b.owner_user_id,
        b.created_at,
        b.updated_at,
        d.city_id,
        d.industry_id,
        c.name as city_name,
        i.name as industry_name,
        b.website_url,
        b.phone,
        b.email,
        CASE 
          WHEN cs.business_id IS NULL OR cs.pages_visited IS NULL OR cs.pages_visited = 0 THEN 'not_crawled'
          WHEN cs.any_completed = TRUE AND cs.pages_limit IS NOT NULL AND cs.pages_visited >= cs.pages_limit THEN 'completed'
          ELSE 'partial'
        END as crawl_status,
        COALESCE(cc.emails_count, 0) as emails_count,
        COALESCE(cc.phones_count, 0) as phones_count,
        COALESCE(cs.pages_visited, 0) as pages_visited,
        cs.finished_at as finished_at
      FROM businesses b
      LEFT JOIN datasets d ON d.id = b.dataset_id
      LEFT JOIN cities c ON c.id = d.city_id
      LEFT JOIN industries i ON i.id = d.industry_id
      LEFT JOIN crawl_stats cs ON cs.business_id = b.id
      LEFT JOIN contact_counts cc ON cc.business_id = b.id
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
      email: b.email || null, // Direct from businesses table
      phone: b.phone || null, // Direct from businesses table
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

/**
 * GET /datasets/:id/crawl/status
 * Get crawl and extraction job status for a dataset
 */
router.get('/:id/crawl/status', authMiddleware, async (req: AuthRequest, res): Promise<void> => {
  try {
    const datasetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const userId = req.userId!;

    if (!datasetId) {
      res.status(400).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Dataset ID is required',
        },
      });
      return;
    }

    // Verify dataset ownership
    await verifyDatasetOwnership(datasetId, userId);

    // Check crawl and extraction job status
    const crawlJobsResult = await pool.query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM crawl_jobs cj
       JOIN businesses b ON b.id = cj.business_id
       WHERE b.dataset_id = $1
         AND cj.status IN ('queued', 'running')`,
      [datasetId]
    );
    const pendingCrawlJobs = parseInt(crawlJobsResult.rows[0]?.count.toString() || '0');

    const runningCrawlJobsResult = await pool.query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM crawl_jobs cj
       JOIN businesses b ON b.id = cj.business_id
       WHERE b.dataset_id = $1
         AND cj.status = 'running'`,
      [datasetId]
    );
    const runningCrawlJobs = parseInt(runningCrawlJobsResult.rows[0]?.count.toString() || '0');

    const completedCrawlJobsResult = await pool.query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM crawl_jobs cj
       JOIN businesses b ON b.id = cj.business_id
       WHERE b.dataset_id = $1
         AND cj.status = 'success'`,
      [datasetId]
    );
    const completedCrawlJobs = parseInt(completedCrawlJobsResult.rows[0]?.count.toString() || '0');

    const failedCrawlJobsResult = await pool.query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM crawl_jobs cj
       JOIN businesses b ON b.id = cj.business_id
       WHERE b.dataset_id = $1
         AND cj.status = 'failed'`,
      [datasetId]
    );
    const failedCrawlJobs = parseInt(failedCrawlJobsResult.rows[0]?.count.toString() || '0');

    // Check extraction jobs
    const extractionJobsResult = await pool.query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM extraction_jobs ej
       JOIN businesses b ON b.id = ej.business_id
       WHERE b.dataset_id = $1
         AND ej.status IN ('pending', 'running')`,
      [datasetId]
    );
    const pendingExtractionJobs = parseInt(extractionJobsResult.rows[0]?.count.toString() || '0');

    const runningExtractionJobsResult = await pool.query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM extraction_jobs ej
       JOIN businesses b ON b.id = ej.business_id
       WHERE b.dataset_id = $1
         AND ej.status = 'running'`,
      [datasetId]
    );
    const runningExtractionJobs = parseInt(runningExtractionJobsResult.rows[0]?.count.toString() || '0');

    const completedExtractionJobsResult = await pool.query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM extraction_jobs ej
       JOIN businesses b ON b.id = ej.business_id
       WHERE b.dataset_id = $1
         AND ej.status = 'completed'`,
      [datasetId]
    );
    const completedExtractionJobs = parseInt(completedExtractionJobsResult.rows[0]?.count.toString() || '0');

    const failedExtractionJobsResult = await pool.query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM extraction_jobs ej
       JOIN businesses b ON b.id = ej.business_id
       WHERE b.dataset_id = $1
         AND ej.status = 'failed'`,
      [datasetId]
    );
    const failedExtractionJobs = parseInt(failedExtractionJobsResult.rows[0]?.count.toString() || '0');

    const allComplete = pendingCrawlJobs === 0 && pendingExtractionJobs === 0;

    res.json({
      data: {
        allComplete,
        crawl: {
          pending: pendingCrawlJobs,
          running: runningCrawlJobs,
          completed: completedCrawlJobs,
          failed: failedCrawlJobs,
        },
        extraction: {
          pending: pendingExtractionJobs,
          running: runningExtractionJobs,
          completed: completedExtractionJobs,
          failed: failedExtractionJobs,
        },
      },
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 1,
        total_returned: 1,
      },
    });
  } catch (error: any) {
    console.error('[datasets] Error fetching crawl status:', error);
    res.status(error.status || 500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch crawl status',
      },
    });
  }
});

export default router;