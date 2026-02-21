import express, { Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { runDiscoveryJob } from '../services/discoveryService.js';
import { getIndustries } from '../db/industries.js';
// Note: cities table may not exist, so getCities() is not imported
import { pool } from '../config/database.js';
import { createDiscoveryRun, getDiscoveryRunById } from '../db/discoveryRuns.js';
import { getDatasetById, verifyDatasetOwnership } from '../db/datasets.js';

const router = express.Router();

/**
 * POST /api/discovery (root handler for frontend compatibility)
 * POST /api/discovery/businesses (explicit path)
 * Discover businesses for a given industry and city
 * Requires authentication
 */
const handleDiscoveryRequest = async (req: AuthRequest, res: Response) => {
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
      const errorMsg = 'Invalid discovery request: request body is missing or empty. Expected JSON body with industry_id/industry_group_id, municipality_gemi_id/prefecture_gemi_id, dataset_id';
      console.error('[API] Validation failed:', errorMsg);
      console.error('[API] req.body type:', typeof req.body);
      console.error('[API] req.body:', req.body);
      throw new Error(errorMsg);
    }
    
    // CRITICAL DEBUG: Log all body keys to see what was sent
    console.log('[discovery] req.body keys:', Object.keys(req.body || {}));
    console.log('[discovery] req.body values:', req.body);
    
    // CRITICAL: Accept gemi_id values (preferred) or internal IDs (for backward compatibility)
    // Support both municipality_gemi_id/industry_gemi_id (preferred) and municipality_id/industry_id (legacy)
    // NEW: Support industry_group_id as alternative to industry_id
    let industry_gemi_id: number | undefined;
    let industry_id: string | undefined;
    let industry_group_id: string | undefined;
    let municipality_gemi_id: number | undefined;
    let municipality_id: string | undefined;
    let prefecture_gemi_id: number | undefined;
    let prefecture_id: string | undefined;
    let dataset_id: string | undefined;
    
    // Accept industry_group_id (new), industry_gemi_id (preferred), or industry_id (legacy)
    if (req.body.industry_group_id !== undefined) {
      industry_group_id = req.body.industry_group_id;
    } else if (req.body.industryGroupId) {
      industry_group_id = req.body.industryGroupId;
      console.warn('[discovery] WARNING: Received camelCase industryGroupId, converted to industry_group_id.');
    }
    
    // Only accept industry_gemi_id or industry_id if industry_group_id is not provided
    if (!industry_group_id) {
      if (req.body.industry_gemi_id !== undefined) {
        industry_gemi_id = typeof req.body.industry_gemi_id === 'number' 
          ? req.body.industry_gemi_id 
          : parseInt(req.body.industry_gemi_id, 10);
      } else if (req.body.industry_id) {
        industry_id = req.body.industry_id;
      } else if (req.body.industryId) {
        industry_id = req.body.industryId;
        console.warn('[discovery] WARNING: Received camelCase industryId, converted to industry_id. Please use industry_gemi_id in future requests.');
      }
    }
    
    // Accept municipality_gemi_id (preferred) or municipality_id
    if (req.body.municipality_gemi_id !== undefined) {
      municipality_gemi_id = typeof req.body.municipality_gemi_id === 'number'
        ? req.body.municipality_gemi_id
        : parseInt(req.body.municipality_gemi_id, 10);
    } else if (req.body.municipality_id) {
      municipality_id = req.body.municipality_id;
    } else if (req.body.municipalityId) {
      municipality_id = req.body.municipalityId;
      console.warn('[discovery] WARNING: Received camelCase municipalityId, converted to municipality_id. Please use municipality_gemi_id in future requests.');
    }
    
    // Accept prefecture_gemi_id or prefecture_id (for prefecture-level discovery)
    if (req.body.prefecture_gemi_id !== undefined) {
      prefecture_gemi_id = typeof req.body.prefecture_gemi_id === 'number'
        ? req.body.prefecture_gemi_id
        : parseInt(req.body.prefecture_gemi_id, 10);
    } else if (req.body.prefecture_id) {
      prefecture_id = req.body.prefecture_id;
    } else if (req.body.prefectureId) {
      prefecture_id = req.body.prefectureId;
      console.warn('[discovery] WARNING: Received camelCase prefectureId, converted to prefecture_id.');
    }
    
    if (req.body.dataset_id) {
      dataset_id = req.body.dataset_id;
    } else if (req.body.datasetId) {
      dataset_id = req.body.datasetId;
      console.warn('[discovery] WARNING: Received camelCase datasetId, converted to dataset_id. Please use snake_case in future requests.');
    }
    
    if (req.body.dataset_id) {
      dataset_id = req.body.dataset_id;
    } else if (req.body.datasetId) {
      dataset_id = req.body.datasetId;
      console.warn('[discovery] WARNING: Received camelCase datasetId, converted to dataset_id. Please use snake_case in future requests.');
    }
    
    console.log('[discovery] payload:', { industry_gemi_id, industry_id, industry_group_id, municipality_gemi_id, municipality_id, prefecture_gemi_id, prefecture_id, dataset_id });
    
    // CRITICAL: Explicit validation
    // Industry: (industry_group_id OR industry_gemi_id OR industry_id) - exactly one
    // Location: (municipality_gemi_id OR municipality_id OR prefecture_gemi_id OR prefecture_id) - at least one
    // dataset_id is optional and will be auto-resolved if missing
    
    // Validate industry selection - must have exactly one
    const hasIndustryGroup = !!industry_group_id;
    const hasIndustryGemi = !!industry_gemi_id;
    const hasIndustryId = !!industry_id;
    
    if (hasIndustryGroup && (hasIndustryGemi || hasIndustryId)) {
      throw new Error('Invalid discovery request: Cannot provide both industry_group_id and industry_id/industry_gemi_id. Use only one.');
    }
    
    if (!hasIndustryGroup && !hasIndustryGemi && !hasIndustryId) {
      throw new Error('Invalid discovery request: missing required field: industry_group_id OR industry_gemi_id OR industry_id');
    }
    
    // Validate location - must have at least one location identifier
    if (!municipality_gemi_id && !municipality_id && !prefecture_gemi_id && !prefecture_id) {
      throw new Error('Invalid discovery request: missing required field: municipality_gemi_id OR municipality_id OR prefecture_gemi_id OR prefecture_id');
    }

    // Handle industry_group_id: if provided, fetch industries from group
    // For now, we'll use the first industry for GEMI discovery
    // In the future, we can make multiple GEMI calls or use merged keywords
    if (industry_group_id) {
      const { getIndustriesByGroup, getIndustryGroupById } = await import('../db/industryGroups.js');
      
      // First verify the industry group exists
      const industryGroup = await getIndustryGroupById(industry_group_id);
      if (!industryGroup) {
        throw new Error(`Industry group ${industry_group_id} not found`);
      }
      
      const industriesInGroup = await getIndustriesByGroup(industry_group_id);
      
      if (industriesInGroup.length === 0) {
        throw new Error(`No industries found for industry group "${industryGroup.name}" (${industry_group_id}). Please select a different industry group or contact support.`);
      }
      
      // Use the first industry (highest search_weight) for GEMI discovery
      // TODO: In the future, support multiple industry discovery or keyword-based discovery
      const primaryIndustry = industriesInGroup[0];
      industry_id = primaryIndustry.id;
      
      // Try to get gemi_id for the primary industry
      const industryGemiResult = await pool.query<{ gemi_id: number }>(
        'SELECT gemi_id FROM industries WHERE id = $1',
        [industry_id]
      );
      if (industryGemiResult.rows.length > 0 && industryGemiResult.rows[0].gemi_id) {
        industry_gemi_id = industryGemiResult.rows[0].gemi_id;
      }
      
      console.log(`[discovery] Using industry group ${industry_group_id} with ${industriesInGroup.length} industries. Primary industry: ${primaryIndustry.name} (${industry_id})`);
      console.log(`[discovery] All industries in group: ${industriesInGroup.map(i => i.name).join(', ')}`);
    } else {
    // Handle industry_group_id: if provided, fetch industries from group
    // For now, we'll use the first industry for GEMI discovery
    // In the future, we can make multiple GEMI calls or use merged keywords
    if (industry_group_id) {
      const { getIndustriesByGroup } = await import('../db/industryGroups.js');
      const industriesInGroup = await getIndustriesByGroup(industry_group_id);
      
      if (industriesInGroup.length === 0) {
        throw new Error(`No industries found for industry group ${industry_group_id}`);
      }
      
      // Use the first industry (highest search_weight) for GEMI discovery
      // TODO: In the future, support multiple industry discovery or keyword-based discovery
      const primaryIndustry = industriesInGroup[0];
      industry_id = primaryIndustry.id;
      
      // Try to get gemi_id for the primary industry
      const industryGemiResult = await pool.query<{ gemi_id: number }>(
        'SELECT gemi_id FROM industries WHERE id = $1',
        [industry_id]
      );
      if (industryGemiResult.rows.length > 0 && industryGemiResult.rows[0].gemi_id) {
        industry_gemi_id = industryGemiResult.rows[0].gemi_id;
      }
      
      console.log(`[discovery] Using industry group ${industry_group_id} with ${industriesInGroup.length} industries. Primary industry: ${primaryIndustry.name} (${industry_id})`);
      console.log(`[discovery] All industries in group: ${industriesInGroup.map(i => i.name).join(', ')}`);
    } else {
      // Resolve industry_id from industry_gemi_id if needed
      if (industry_gemi_id && !industry_id) {
        const industryResult = await pool.query<{ id: string }>(
          'SELECT id FROM industries WHERE gemi_id = $1',
          [industry_gemi_id]
        );
        if (industryResult.rows.length === 0) {
          throw new Error(`Industry with gemi_id ${industry_gemi_id} not found`);
        }
        industry_id = industryResult.rows[0].id;
        console.log(`[discovery] Resolved industry_gemi_id ${industry_gemi_id} to industry_id ${industry_id}`);
      } else if (industry_id) {
        // Validate UUID format for industry_id (only if not using gemi_id)
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        if (!uuidRegex.test(industry_id)) {
          throw new Error(`Invalid discovery request: industry_id must be a valid UUID, got: ${industry_id}`);
        }
      }
    }
    }
    
    // Resolve municipality_id from municipality_gemi_id if needed
    if (municipality_gemi_id && !municipality_id) {
      const municipalityResult = await pool.query<{ id: string }>(
        'SELECT id FROM municipalities WHERE gemi_id = $1',
        [municipality_gemi_id.toString()]
      );
      if (municipalityResult.rows.length === 0) {
        throw new Error(`Municipality with gemi_id ${municipality_gemi_id} not found`);
      }
      municipality_id = municipalityResult.rows[0].id;
      console.log(`[discovery] Resolved municipality_gemi_id ${municipality_gemi_id} to municipality_id ${municipality_id}`);
    }
    
    // We use municipalities directly - no city mapping needed
    if (municipality_id) {
      console.log(`[discovery] Using municipality_id ${municipality_id} directly`);
    }
    
    // dataset_id is optional, but if provided, must be valid UUID
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (dataset_id && !uuidRegex.test(dataset_id)) {
      throw new Error(`Invalid discovery request: dataset_id must be a valid UUID, got: ${dataset_id}`);
    }
    
    // Get user's plan from database
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

    // Get industry and municipality info
    const industries = await getIndustries();
    const industry = industries.find((i) => String(i.id) === String(industry_id!));

    if (!industry) {
      const availableIds = industries.map(i => i.id).join(', ');
      const errorMsg = `Industry with ID ${industry_id} not found. Available industry IDs: ${availableIds || 'none'}`;
      console.error(`[API] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Get municipality info if municipality_id is provided
    let municipalityName = 'Unknown';
    if (municipality_id) {
      const municipalityResult = await pool.query<{ descr: string; descr_en: string }>(
        `SELECT descr, descr_en FROM municipalities WHERE id = $1 OR gemi_id = $2`,
        [municipality_id, municipality_id.replace('mun-', '')]
      );
      if (municipalityResult.rows.length > 0) {
        municipalityName = municipalityResult.rows[0].descr || municipalityResult.rows[0].descr_en || 'Unknown';
      }
    }

    console.log('[API] Starting discovery job for:', { 
      industry: industry.name, 
      municipality: municipalityName,
      prefecture: prefecture_gemi_id || prefecture_id || 'N/A'
    });

    // Generate descriptive dataset name (used for both initial creation and mismatch cases)
    let datasetName: string | undefined;
    
    // Get industry/industry group name
    let industryNameForDataset: string;
    if (industry_group_id) {
      const { getIndustryGroupById } = await import('../db/industryGroups.js');
      const industryGroup = await getIndustryGroupById(industry_group_id);
      industryNameForDataset = industryGroup?.name || industry.name;
    } else {
      industryNameForDataset = industry.name;
    }
    
    // Get location name (preference: prefecture > municipality > city)
    let locationName: string = 'Unknown';
    
    // Try to get prefecture name if we have municipality_id
    if (municipality_id) {
      const prefectureResult = await pool.query<{ descr: string; descr_en: string }>(
        `SELECT p.descr, p.descr_en 
         FROM prefectures p
         JOIN municipalities m ON m.prefecture_id = p.id
         WHERE m.id = $1 OR m.gemi_id = $2
         LIMIT 1`,
        [municipality_id, municipality_id.replace('mun-', '')]
      );
      
      if (prefectureResult.rows.length > 0) {
        locationName = prefectureResult.rows[0].descr_en || prefectureResult.rows[0].descr || municipalityName;
      } else {
        locationName = municipalityName;
      }
    }
    
    // Generate dataset name: "Industry Group - Region - Municipality (if exists)"
    // Format: industry group - prefecture - municipality (if municipality exists)
    let municipalityPart = '';
    if (municipality_id && municipalityName !== 'Unknown') {
      municipalityPart = ` - ${municipalityName}`;
    }
    datasetName = `${industryNameForDataset} - ${locationName}${municipalityPart}`;

    // Find or resolve dataset ID FIRST (before creating discovery_run)
    // dataset_id is optional - if not provided, create one with null city_id (using municipalities)
    let finalDatasetId = dataset_id;
    
    if (!finalDatasetId) {
      console.log('[API] dataset_id not provided, creating new dataset with null city_id (using municipalities)...');
      
      // Create dataset directly with null city_id (we use municipalities, not cities)
      const { getOrCreateDataset } = await import('../db/datasets.js');
      const dataset = await getOrCreateDataset(
        userId,
        null, // city_id is null when using municipality/prefecture
        industry.id,
        datasetName
      );
      finalDatasetId = dataset.id;
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
    
    // CRITICAL: Verify dataset matches requested industry
    if (dataset.industry_id !== industry.id) {
      console.error(`[API] Dataset industry mismatch detected:`);
      console.error(`[API]   Requested: industry_id=${industry.id} (${industry.name})`);
      console.error(`[API]   Dataset: industry_id=${dataset.industry_id}`);
      console.error(`[API]   Creating new dataset instead of reusing mismatched one...`);
      
      // Create a new dataset that matches the request (with null city_id, using municipalities)
      const { getOrCreateDataset } = await import('../db/datasets.js');
      const newDataset = await getOrCreateDataset(
        userId,
        null, // city_id is null when using municipality/prefecture
        industry.id,
        datasetName
      );
      finalDatasetId = newDataset.id;
      console.log(`[API] Created new matching dataset: ${finalDatasetId}`);
      
      // Re-fetch the dataset to ensure we have the correct one
      const fetchedDataset = await getDatasetById(finalDatasetId);
      if (!fetchedDataset) {
        throw new Error(`Failed to create matching dataset`);
      }
      // Update dataset reference for rest of function
      Object.assign(dataset, fetchedDataset);
    }

    // CRITICAL: Create discovery_run at the VERY START (synchronously, before returning)
    // This makes discovery observable and stateful
    console.log('[API] About to create discovery_run with datasetId:', finalDatasetId, 'userId:', userId, 'industry_group_id:', industry_group_id);
    const discoveryRun = await createDiscoveryRun(finalDatasetId, userId, industry_group_id || undefined);
    console.log('[API] Created discovery_run:', JSON.stringify({
      id: discoveryRun.id,
      status: discoveryRun.status,
      dataset_id: discoveryRun.dataset_id,
      created_at: discoveryRun.created_at
    }, null, 2));

    // Run discovery job asynchronously (don't wait for completion)
    // Uses GEMI API as the discovery source
    // Extraction will happen in the background via extraction worker
    console.log('[API] Starting discovery job asynchronously...');
    console.log('[API] Discovery job params:', {
      userId,
      industry_id: industry.id,
      industry_gemi_id: industry_gemi_id,
      municipality_gemi_id: municipality_gemi_id,
      municipality_id: municipality_id || undefined,
      prefecture_gemi_id: prefecture_gemi_id || undefined,
      prefecture_id: prefecture_id || undefined,
      datasetId: finalDatasetId,
      discoveryRunId: discoveryRun.id
    });
    
    console.log('[API] About to call runDiscoveryJob...');
    console.log('🚨 ABOUT TO INSERT BUSINESSES - Discovery job starting');
    
    const jobPromise = runDiscoveryJob({
      userId,
      industry_id: industry.id, // Internal industry_id (resolved from gemi_id if needed)
      industry_gemi_id: industry_gemi_id, // GEMI industry ID (preferred)
      industry_group_id: industry_group_id || undefined, // Industry group ID (if provided)
      municipality_id: municipality_id || undefined, // Internal municipality_id (resolved from gemi_id if needed)
      municipality_gemi_id: municipality_gemi_id, // GEMI municipality ID (preferred)
      prefecture_id: prefecture_id || undefined, // Internal prefecture_id
      prefecture_gemi_id: prefecture_gemi_id || undefined, // GEMI prefecture ID (for prefecture-level discovery)
      latitude: undefined, // Not needed for GEMI-based discovery
      longitude: undefined, // Not needed for GEMI-based discovery
      cityRadiusKm: undefined, // Not needed for GEMI-based discovery
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
        dataset_id: finalDatasetId,
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
    console.error('[API] Error in discovery endpoint:', error);
    console.error('[API] Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      stack: error.stack,
      body: req.body,
    });
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
    
    // Determine if this is a validation error (400) or server error (500)
    const isValidationError = 
      error.message?.includes('No industries found for industry group') ||
      error.message?.includes('Industry group') && error.message?.includes('not found') ||
      error.message?.includes('Invalid discovery request') ||
      error.message?.includes('missing required field') ||
      error.message?.includes('Unauthorized');
    
    const statusCode = isValidationError ? 400 : 500;
    
    return res.status(statusCode).json({
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
};

// Register handler for both root and /businesses paths
router.post('/', authMiddleware, handleDiscoveryRequest);
router.post('/businesses', authMiddleware, handleDiscoveryRequest);

/**
 * GET /api/discovery/runs/:runId/results
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

    // Get business counts for this discovery run
    const businessCounts = await pool.query<{ 
      total: string; 
      created: string;
    }>(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at >= $1) as created
      FROM businesses 
      WHERE discovery_run_id = $2`,
      [discoveryRun.created_at, runId]
    );

    const businessesFound = parseInt(businessCounts.rows[0]?.total || '0', 10);
    const businessesCreated = parseInt(businessCounts.rows[0]?.created || '0', 10);

    // Return discovery results with business counts and cost estimates
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
        businesses_found: businessesFound,
        businesses_created: businessesCreated,
        // Cost estimation data (ESTIMATES ONLY - no billing occurs)
        cost_estimates: discoveryRun.cost_estimates || null,
      },
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: 1,
        total_returned: 1,
        message: discoveryRun.status === 'completed'
          ? `Discovery completed: ${businessesFound} businesses found, ${businessesCreated} created.`
          : 'Discovery is still running...',
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

/**
 * GET /api/discovery/runs
 * Get all discovery runs for the authenticated user
 * Requires authentication
 */
router.get('/runs', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;

    // Get user's plan
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

    // Get all discovery runs for user's datasets
    const discoveryRunsResult = await pool.query<{
      id: string;
      dataset_id: string;
      status: string;
      created_at: Date;
      completed_at: Date | null;
      businesses_found: string;
      dataset_name: string;
      industry_name: string;
      city_name: string | null;
    }>(
      `SELECT 
        dr.id,
        dr.dataset_id,
        dr.status,
        dr.created_at,
        dr.completed_at,
        COUNT(b.id) as businesses_found,
        d.name as dataset_name,
        i.name as industry_name,
        NULL as city_name
      FROM discovery_runs dr
      JOIN datasets d ON d.id = dr.dataset_id
      LEFT JOIN industries i ON i.id = d.industry_id
      LEFT JOIN businesses b ON b.discovery_run_id = dr.id
      WHERE d.user_id = $1
      GROUP BY dr.id, dr.dataset_id, dr.status, dr.created_at, dr.completed_at, d.name, i.name
      ORDER BY dr.created_at DESC
      LIMIT 100`,
      [userId]
    );

    const discoveryRuns = discoveryRunsResult.rows.map(row => ({
      id: row.id,
      dataset_id: row.dataset_id,
      status: row.status,
      created_at: row.created_at instanceof Date 
        ? row.created_at.toISOString() 
        : row.created_at,
      completed_at: row.completed_at instanceof Date 
        ? row.completed_at.toISOString() 
        : row.completed_at,
      businesses_found: parseInt(row.businesses_found || '0', 10),
      dataset_name: row.dataset_name,
      industry_name: row.industry_name,
      city_name: row.city_name,
    }));

    return res.json({
      data: discoveryRuns,
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: discoveryRuns.length,
        total_returned: discoveryRuns.length,
      },
    });
  } catch (error: any) {
    console.error('[API] Error getting all discovery runs:', error);
    return res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to get discovery runs',
      },
    });
  }
});

export default router;
