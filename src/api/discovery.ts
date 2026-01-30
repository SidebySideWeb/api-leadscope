import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { runDiscoveryJob } from '../services/discoveryService.js';
import { getIndustries } from '../db/industries.js';
import { getCities } from '../db/cities.js';
import { pool } from '../config/database.js';
import { createDiscoveryRun } from '../db/discoveryRuns.js';
import { getDatasetById } from '../db/datasets.js';

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
    // Pass discovery_run_id so the job can link businesses and extraction_jobs to it
    runDiscoveryJob({
      userId,
      industry: industry.name,
      city: city.name,
      latitude: city.latitude || undefined,
      longitude: city.longitude || undefined,
      useGeoGrid: true, // Use geo-grid discovery
      cityRadiusKm: city.radius_km || undefined,
      datasetId: finalDatasetId, // Use resolved dataset ID
      discoveryRunId: discoveryRun.id, // Pass discovery_run_id to link businesses
    }).catch((error) => {
      // Log errors but don't block the response
      console.error('[API] Discovery job error:', error);
    });

    // Return the discovery_run in the response (not empty data)
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
        message: 'Discovery started. Businesses will be available shortly.',
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

export default router;
