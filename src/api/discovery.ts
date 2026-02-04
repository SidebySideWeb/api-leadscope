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
  console.log('\n[API] ===== DISCOVERY API ENDPOINT CALLED =====');
  console.log('[API] Request method:', req.method);
  console.log('[API] Request path:', req.path);
  console.log('[API] Request body:', JSON.stringify(req.body, null, 2));
  console.log('[API] Authorization header:', req.headers.authorization ? 'present' : 'missing');
  
  try {
    // CRITICAL: Fail-fast if user is missing (auth middleware should have set this)
    if (!req.user || !req.userId) {
      console.error('[API] ERROR: req.user or req.userId is missing after auth middleware');
      throw new Error('Unauthorized: missing or invalid token');
    }

    const userId = req.userId;
    console.log('[discovery] user:', req.user.id);
    
    // CRITICAL: Check if body exists
    if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
      const errorMsg = 'Invalid discovery request: request body is missing or empty. Expected JSON body with industry_id, city_id, dataset_id';
      console.error('[API] Validation failed:', errorMsg);
      console.error('[API] req.body type:', typeof req.body);
      console.error('[API] req.body:', req.body);
      throw new Error(errorMsg);
    }
    
    // CRITICAL DEBUG: Log all body keys to see what was sent
    console.log('[discovery] req.body keys:', Object.keys(req.body || {}));
    console.log('[discovery] req.body values:', req.body);
    
    // CRITICAL: Accept snake_case payload (industry_id, city_id, dataset_id)
    // Support camelCase with auto-conversion and warning (for frontend compatibility)
    let industry_id: string | undefined;
    let city_id: string | undefined;
    let dataset_id: string | undefined;
    
    // Prefer snake_case, fallback to camelCase with warning
    if (req.body.industry_id) {
      industry_id = req.body.industry_id;
    } else if (req.body.industryId) {
      industry_id = req.body.industryId;
      console.warn('[discovery] WARNING: Received camelCase industryId, converted to industry_id. Please use snake_case in future requests.');
    }
    
    if (req.body.city_id) {
      city_id = req.body.city_id;
    } else if (req.body.cityId) {
      city_id = req.body.cityId;
      console.warn('[discovery] WARNING: Received camelCase cityId, converted to city_id. Please use snake_case in future requests.');
    }
    
    if (req.body.dataset_id) {
      dataset_id = req.body.dataset_id;
    } else if (req.body.datasetId) {
      dataset_id = req.body.datasetId;
      console.warn('[discovery] WARNING: Received camelCase datasetId, converted to dataset_id. Please use snake_case in future requests.');
    }
    
    console.log('[discovery] payload:', { industry_id, city_id, dataset_id });
    
    // CRITICAL: Explicit validation - industry_id and city_id are required
    // dataset_id is optional and will be auto-resolved if missing
    if (!industry_id || !city_id) {
      const missing = [];
      if (!industry_id) missing.push('industry_id (or industryId)');
      if (!city_id) missing.push('city_id (or cityId)');
      
      const errorMsg = `Invalid discovery request: missing required fields: ${missing.join(', ')}. Expected: industry_id, city_id (dataset_id is optional). Received body keys: ${Object.keys(req.body || {}).join(', ') || 'none'}`;
      console.error('[API] Validation failed:', errorMsg);
      console.error('[API] Full req.body:', JSON.stringify(req.body, null, 2));
      throw new Error(errorMsg);
    }

    // Validate UUID format for required IDs (industry_id and city_id)
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!uuidRegex.test(industry_id!)) {
      throw new Error(`Invalid discovery request: industry_id must be a valid UUID, got: ${industry_id}`);
    }
    if (!uuidRegex.test(city_id!)) {
      throw new Error(`Invalid discovery request: city_id must be a valid UUID, got: ${city_id}`);
    }
    // dataset_id is optional, but if provided, must be valid UUID
    if (dataset_id && !uuidRegex.test(dataset_id)) {
      throw new Error(`Invalid discovery request: dataset_id must be a valid UUID, got: ${dataset_id}`);
    }
    
    // Get user's plan from database
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

    // Get industry and city names from IDs
    const [industries, cities] = await Promise.all([
      getIndustries(),
      getCities(),
    ]);

    console.log('[API] Available industries:', industries.map(i => ({ id: i.id, name: i.name })));
    console.log('[API] Available cities:', cities.map(c => ({ id: c.id, name: c.name })).slice(0, 10)); // Log first 10

    // Both industries and cities use UUIDs (strings), so compare as strings
    // TypeScript: industry_id and city_id are guaranteed to be strings here due to validation above
    const industry = industries.find((i) => String(i.id) === String(industry_id!));
    const city = cities.find((c) => String(c.id) === String(city_id!));

    if (!industry) {
      const availableIds = industries.map(i => i.id).join(', ');
      const errorMsg = `Industry with ID ${industry_id} not found. Available industry IDs: ${availableIds || 'none'}`;
      console.error(`[API] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    if (!city) {
      const errorMsg = `City with ID ${city_id} not found`;
      console.error(`[API] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    console.log('[API] Starting discovery job for:', { industry: industry.name, city: city.name });

    // Find or resolve dataset ID FIRST (before creating discovery_run)
    // dataset_id is optional - if not provided, find or create one
    let finalDatasetId = dataset_id;
    if (!finalDatasetId) {
      console.log('[API] dataset_id not provided, attempting to find existing dataset...');
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
        [userId, city_id!, industry_id!]
      );
      finalDatasetId = existingDataset.rows[0]?.id;
      
      if (finalDatasetId) {
        console.log('[API] Found existing dataset:', finalDatasetId);
      }
    }

    // If dataset doesn't exist yet, create it synchronously so we can link discovery_run to it
    if (!finalDatasetId) {
      console.log('[API] Creating new dataset...');
      const { resolveDataset } = await import('../services/datasetResolver.js');
      const resolverResult = await resolveDataset({
        userId,
        cityId: city.id, // Use city ID instead of name to prevent city creation
        industryId: industry.id, // Use industry ID instead of name to prevent industry creation
      });
      finalDatasetId = resolverResult.dataset.id;
      console.log('[API] Created dataset for discovery_run:', finalDatasetId);
    }
    
    // Verify dataset exists and user owns it
    const dataset = await getDatasetById(finalDatasetId);
    if (!dataset) {
      const errorMsg = `Dataset with ID ${finalDatasetId} not found`;
      console.error(`[API] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Verify ownership
    const isOwner = await verifyDatasetOwnership(finalDatasetId, userId);
    if (!isOwner) {
      const errorMsg = `Access denied: You do not own dataset ${finalDatasetId}`;
      console.error(`[API] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // CRITICAL: Create discovery_run at the VERY START (synchronously, before returning)
    // This makes discovery observable and stateful
    console.log('[API] About to create discovery_run with datasetId:', finalDatasetId, 'userId:', userId);
    const discoveryRun = await createDiscoveryRun(finalDatasetId, userId);
    console.log('[API] Created discovery_run:', JSON.stringify({
      id: discoveryRun.id,
      status: discoveryRun.status,
      dataset_id: discoveryRun.dataset_id,
      created_at: discoveryRun.created_at
    }, null, 2));

    // Run discovery job asynchronously (don't wait for completion)
    // Uses V2 grid-based discovery (always uses grid + keyword expansion)
    // Extraction will happen in the background via extraction worker
    console.log('[API] Starting discovery job asynchronously...');
    console.log('[API] Discovery job params:', {
      userId,
      industry_id: industry.id,
      city_id: city.id,
      latitude: city.latitude,
      longitude: city.longitude,
      cityRadiusKm: city.radius_km,
      datasetId: finalDatasetId,
      discoveryRunId: discoveryRun.id
    });
    
    console.log('[API] About to call runDiscoveryJob...');
    console.log('🚨 ABOUT TO INSERT BUSINESSES - Discovery job starting');
    
    const jobPromise = runDiscoveryJob({
      userId,
      industry_id: industry.id, // Use industry_id for keyword-based discovery
      city_id: city.id, // Use city_id for coordinate-based discovery
      latitude: city.latitude || undefined,
      longitude: city.longitude || undefined,
      cityRadiusKm: city.radius_km || undefined,
      datasetId: finalDatasetId, // Use provided dataset ID
      discoveryRunId: discoveryRun.id, // Pass discovery_run_id to link businesses
    });
    
    console.log('[API] runDiscoveryJob called, promise created');
    
    jobPromise.catch((error) => {
      // Log errors but don't block the response
      console.error('[API] ===== DISCOVERY JOB ERROR (ASYNC) =====');
      console.error('[API] Discovery job error:', error);
      console.error('[API] Discovery job error message:', error instanceof Error ? error.message : String(error));
      console.error('[API] Discovery job error stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('[API] Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    });
    
    console.log('[API] Error handler attached to job promise');

    // Return discovery_run immediately - frontend can poll for results
    // Extraction will happen in background and businesses will be available via /businesses endpoint
    const responseData = {
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
    };
    
    console.log('[API] ===== SENDING RESPONSE =====');
    console.log('[API] Response data:', JSON.stringify(responseData, null, 2));
    console.log('[API] Response data length:', responseData.data.length);
    
    return res.json(responseData);
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
