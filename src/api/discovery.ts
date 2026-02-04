import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { runDiscoveryJob } from '../services/discoveryService.js';
import { getIndustries } from '../db/industries.js';
import { getCities } from '../db/cities.js';
import { pool } from '../config/database.js';
import { createDiscoveryRun, getDiscoveryRunById } from '../db/discoveryRuns.js';
import { getDatasetById, verifyDatasetOwnership } from '../db/datasets.js';

const router = express.Router();

/**
 * POST /discovery/businesses
 * Discover businesses for a given industry and city
 * Requires authentication
 */
router.post('/businesses', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { industryId: rawIndustryId, cityId: rawCityId, datasetId } = req.body;
    
    // Get user's plan from database
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

    console.log('[API] Discovery request body:', JSON.stringify(req.body));
    console.log('[API] Discovery request:', { rawIndustryId, rawCityId, datasetId, userId, types: { industryId: typeof rawIndustryId, cityId: typeof rawCityId } });

    // Both industries and cities use UUIDs (strings)
    const industryId = rawIndustryId; // UUID string
    const cityId = rawCityId; // UUID string

    // Validate required fields
    if (!industryId || industryId === null || industryId === undefined) {
      console.log('[API] Validation failed: missing industryId', { industryId });
      return res.status(400).json({
        data: null,
        meta: {
          plan_id: userPlan,
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Missing or invalid industryId',
        },
      });
    }

    if (!cityId || cityId === null || cityId === undefined) {
      console.log('[API] Validation failed: missing or invalid cityId', { cityId });
      return res.status(400).json({
        data: null,
        meta: {
          plan_id: userPlan,
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Missing or invalid cityId',
        },
      });
    }

    // Get industry and city names from IDs
    const [industries, cities] = await Promise.all([
      getIndustries(),
      getCities(),
    ]);

    console.log('[API] Available industries:', industries.map(i => ({ id: i.id, name: i.name })));
    console.log('[API] Available cities:', cities.map(c => ({ id: c.id, name: c.name })).slice(0, 10)); // Log first 10

    // Both industries and cities use UUIDs (strings), so compare as strings
    const industry = industries.find((i) => String(i.id) === String(industryId));
    const city = cities.find((c) => String(c.id) === String(cityId));

    if (!industry) {
      const availableIds = industries.map(i => i.id).join(', ');
      console.log(`[API] Industry ID ${industryId} not found. Available IDs: ${availableIds}`);
      return res.status(400).json({
        data: null,
        meta: {
          plan_id: userPlan,
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: `Industry with ID ${industryId} not found. Available industry IDs: ${availableIds || 'none'}`,
        },
      });
    }

    if (!city) {
      return res.status(400).json({
        data: null,
        meta: {
          plan_id: userPlan,
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: `City with ID ${cityId} not found`,
        },
      });
    }

    console.log('[API] Starting discovery job for:', { industry: industry.name, city: city.name });

    // Find or resolve dataset ID FIRST (before creating discovery_run)
    let finalDatasetId = datasetId;
    if (!finalDatasetId) {
      // Try to find existing dataset first
      const existingDataset = await pool.query<{ id: string }>(
        `
        SELECT id FROM datasets
        WHERE user_id = $1
          AND city_id = $2
          AND industry_id = $3
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [userId, cityId, industryId]
      );
      finalDatasetId = existingDataset.rows[0]?.id;
    }

    // If dataset doesn't exist yet, create it synchronously so we can link discovery_run to it
    if (!finalDatasetId) {
      const { resolveDataset } = await import('../services/datasetResolver.js');
      const resolverResult = await resolveDataset({
        userId,
        cityName: city.name,
        industryName: industry.name,
      });
      finalDatasetId = resolverResult.dataset.id;
      console.log('[API] Created dataset for discovery_run:', finalDatasetId);
    }

    // CRITICAL: Create discovery_run at the VERY START (synchronously, before returning)
    // This makes discovery observable and stateful
    const discoveryRun = await createDiscoveryRun(finalDatasetId, userId);
    console.log('[API] Created discovery_run:', discoveryRun.id);

    // Run discovery job asynchronously (don't wait for completion)
    // Uses V2 grid-based discovery (always uses grid + keyword expansion)
    // Extraction will happen in the background via extraction worker
    console.log('[API] Starting discovery job asynchronously...');
    runDiscoveryJob({
      userId,
      industry_id: industry.id, // Use industry_id for keyword-based discovery
      city_id: city.id, // Use city_id for coordinate-based discovery
      latitude: city.latitude || undefined,
      longitude: city.longitude || undefined,
      cityRadiusKm: city.radius_km || undefined,
      datasetId: finalDatasetId, // Use resolved dataset ID
      discoveryRunId: discoveryRun.id, // Pass discovery_run_id to link businesses
    }).catch((error) => {
      // Log errors but don't block the response
      console.error('[API] Discovery job error:', error);
    });

    // Return discovery_run immediately - frontend can poll for results
    // Extraction will happen in background and businesses will be available via /businesses endpoint
    return res.json({
      data: [{
        id: discoveryRun.id,
        status: discoveryRun.status,
        created_at: discoveryRun.created_at instanceof Date 
          ? discoveryRun.created_at.toISOString() 
          : discoveryRun.created_at,
      }],
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: 1,
        total_returned: 1,
        message: 'Discovery started. Businesses will be available shortly. Use /businesses endpoint to fetch results.',
      },
    });
  } catch (error: any) {
    console.error('[API] Error in discovery:', error);
    // Try to get user plan for error response, but don't fail if it errors
    let errorPlan = 'demo';
    try {
      const userId = (req as AuthRequest).userId;
      if (userId) {
        const userResult = await pool.query<{ plan: string }>(
          'SELECT plan FROM users WHERE id = $1',
          [userId]
        );
        errorPlan = (userResult.rows[0]?.plan || 'demo') as string;
      }
    } catch {
      // Ignore errors getting plan
    }
    
    return res.status(500).json({
      data: null,
      meta: {
        plan_id: errorPlan,
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to discover businesses',
      },
    });
  }
});

/**
 * GET /discovery/runs/:runId/results
 * Get discovery results with cost estimates for a specific discovery run
 * Requires authentication and dataset ownership
 */
router.get('/runs/:runId/results', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;

    if (!runId) {
      return res.status(400).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'runId is required',
        },
      });
    }

    // Get discovery run
    const discoveryRun = await getDiscoveryRunById(runId);
    if (!discoveryRun) {
      return res.status(404).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Discovery run not found',
        },
      });
    }

    // Verify dataset ownership
    const dataset = await getDatasetById(discoveryRun.dataset_id);
    if (!dataset) {
      return res.status(404).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Dataset not found',
        },
      });
    }

    const isOwner = await verifyDatasetOwnership(discoveryRun.dataset_id, userId);
    if (!isOwner) {
      return res.status(403).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Access denied: You do not own this dataset',
        },
      });
    }

    // Get user's plan
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

    // Return discovery results with cost estimates
    // IMPORTANT: These are ESTIMATES ONLY - no billing occurs
    return res.json({
      data: {
        id: discoveryRun.id,
        status: discoveryRun.status,
        created_at: discoveryRun.created_at instanceof Date 
          ? discoveryRun.created_at.toISOString() 
          : discoveryRun.created_at,
        completed_at: discoveryRun.completed_at instanceof Date 
          ? discoveryRun.completed_at.toISOString() 
          : discoveryRun.completed_at,
        // Cost estimation data (ESTIMATES ONLY - no billing occurs)
        cost_estimates: discoveryRun.cost_estimates || null,
      },
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: 1,
        total_returned: 1,
        message: discoveryRun.cost_estimates 
          ? 'Cost estimates are available. These are estimates only, not guarantees.'
          : 'Discovery is still running or estimates are not yet available.',
      },
    });
  } catch (error: any) {
    console.error('[API] Error getting discovery results:', error);
    return res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to get discovery results',
      },
    });
  }
});

export default router;
