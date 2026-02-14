import express, { Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { runDiscoveryJob } from '../services/discoveryService.js';
import { getIndustries } from '../db/industries.js';
import { getCities } from '../db/cities.js';
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
      const errorMsg = 'Invalid discovery request: request body is missing or empty. Expected JSON body with industry_id, city_id, dataset_id';
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
    let industry_gemi_id: number | undefined;
    let industry_id: string | undefined;
    let municipality_gemi_id: number | undefined;
    let municipality_id: string | undefined;
    let city_id: string | undefined;
    let dataset_id: string | undefined;
    
    // Accept industry_gemi_id (preferred) or industry_id (legacy)
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
    
    // Accept municipality_gemi_id (preferred) or municipality_id/city_id (legacy)
    if (req.body.municipality_gemi_id !== undefined) {
      municipality_gemi_id = typeof req.body.municipality_gemi_id === 'number'
        ? req.body.municipality_gemi_id
        : parseInt(req.body.municipality_gemi_id, 10);
    } else if (req.body.municipality_id) {
      municipality_id = req.body.municipality_id;
    } else if (req.body.municipalityId) {
      municipality_id = req.body.municipalityId;
      console.warn('[discovery] WARNING: Received camelCase municipalityId, converted to municipality_id. Please use municipality_gemi_id in future requests.');
    } else if (req.body.city_id) {
      const tempCityId = req.body.city_id;
      // If city_id looks like a municipality ID (starts with "mun-"), treat it as municipality_id
      if (tempCityId && tempCityId.startsWith('mun-')) {
        console.log('[discovery] city_id looks like municipality ID, converting to municipality_id');
        municipality_id = tempCityId;
        city_id = undefined;
      } else {
        city_id = tempCityId;
      }
    } else if (req.body.cityId) {
      city_id = req.body.cityId;
      console.warn('[discovery] WARNING: Received camelCase cityId, converted to city_id. Please use municipality_gemi_id in future requests.');
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
    
    console.log('[discovery] payload:', { industry_gemi_id, industry_id, municipality_gemi_id, municipality_id, city_id, dataset_id });
    
    // CRITICAL: Explicit validation - (industry_gemi_id OR industry_id) and (municipality_gemi_id OR municipality_id OR city_id) are required
    // dataset_id is optional and will be auto-resolved if missing
    if ((!industry_gemi_id && !industry_id) || (!municipality_gemi_id && !municipality_id && !city_id)) {
      const missing = [];
      if (!industry_gemi_id && !industry_id) missing.push('industry_gemi_id OR industry_id');
      if (!municipality_gemi_id && !municipality_id && !city_id) missing.push('municipality_gemi_id OR municipality_id OR city_id');
      
      const errorMsg = `Invalid discovery request: missing required fields: ${missing.join(', ')}. Expected: (industry_gemi_id OR industry_id), (municipality_gemi_id OR municipality_id OR city_id). Received body keys: ${Object.keys(req.body || {}).join(', ') || 'none'}`;
      console.error('[API] Validation failed:', errorMsg);
      console.error('[API] Full req.body:', JSON.stringify(req.body, null, 2));
      throw new Error(errorMsg);
    }

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
    
    // If municipality_id is provided, map it to city_id (for dataset creation)
    if (municipality_id && !city_id) {
      console.log(`[discovery] Mapping municipality_id ${municipality_id} to city_id...`);
      
      // Find municipality by ID (could be "mun-XXXXX" format or UUID)
      const municipalityResult = await pool.query<{ id: string; descr: string; descr_en: string }>(
        `SELECT id, descr, descr_en FROM municipalities 
         WHERE id = $1 OR gemi_id = $2`,
        [municipality_id, municipality_id.replace('mun-', '')]
      );
      
      if (municipalityResult.rows.length === 0) {
        throw new Error(`Municipality with ID ${municipality_id} not found`);
      }
      
      const municipality = municipalityResult.rows[0];
      console.log(`[discovery] Found municipality: ${municipality.descr} (${municipality.descr_en})`);
      
      // Find matching city by name (try multiple strategies)
      let cityResult = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM cities 
         WHERE name ILIKE $1 OR name ILIKE $2 OR normalized_name ILIKE $1 OR normalized_name ILIKE $2
         LIMIT 1`,
        [municipality.descr, municipality.descr_en]
      );
      
      // Strategy 1: Try exact match with cleaned names (remove extra spaces, slashes)
      if (cityResult.rows.length === 0) {
        const cleanDescr = municipality.descr.split('/')[0].trim(); // Take first part before "/"
        const cleanDescrEn = municipality.descr_en?.split('/')[0].trim() || '';
        cityResult = await pool.query<{ id: string; name: string }>(
          `SELECT id, name FROM cities 
           WHERE name ILIKE $1 OR name ILIKE $2 OR normalized_name ILIKE $1 OR normalized_name ILIKE $2
           LIMIT 1`,
          [cleanDescr, cleanDescrEn]
        );
      }
      
      // Strategy 2: Try partial match with cleaned name
      if (cityResult.rows.length === 0) {
        const cleanDescr = municipality.descr.split('/')[0].trim();
        cityResult = await pool.query<{ id: string; name: string }>(
          `SELECT id, name FROM cities 
           WHERE name ILIKE $1 OR normalized_name ILIKE $1
           LIMIT 1`,
          [`%${cleanDescr}%`]
        );
      }
      
      // Strategy 3: Try matching any word from the municipality name
      if (cityResult.rows.length === 0) {
        const words = municipality.descr.split(/[\s\/]+/).filter(w => w.length > 2);
        for (const word of words) {
          cityResult = await pool.query<{ id: string; name: string }>(
            `SELECT id, name FROM cities 
             WHERE name ILIKE $1 OR normalized_name ILIKE $1
             LIMIT 1`,
            [`%${word}%`]
          );
          if (cityResult.rows.length > 0) break;
        }
      }
      
      // Strategy 4: Find a city in the same prefecture as fallback (try first word of municipality)
      if (cityResult.rows.length === 0) {
        console.log(`[discovery] No direct city match found, trying to find city in same prefecture...`);
        const firstWord = municipality.descr.split(/[\s\/]+/)[0]?.trim();
        if (firstWord && firstWord.length > 2) {
          cityResult = await pool.query<{ id: string; name: string }>(
            `SELECT id, name FROM cities 
             WHERE name ILIKE $1 OR normalized_name ILIKE $1
             ORDER BY CASE WHEN name ILIKE $2 THEN 1 ELSE 2 END
             LIMIT 1`,
            [`%${firstWord}%`, `${firstWord}%`]
          );
        }
      }
      
      // If no city match found, that's OK - we'll use municipality_id directly
      // Don't throw error, just log and proceed with municipality_id
      if (cityResult.rows.length > 0) {
        city_id = cityResult.rows[0].id;
        console.log(`[discovery] Mapped municipality "${municipality.descr}" to city: ${cityResult.rows[0].name} (${city_id})`);
      } else {
        console.log(`[discovery] No city match found for municipality "${municipality.descr}". Will use municipality_id directly.`);
      }
    }
    
    // Validate city_id is UUID after mapping (if provided)
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (city_id && !uuidRegex.test(city_id)) {
      throw new Error(`Invalid discovery request: city_id must be a valid UUID after mapping, got: ${city_id}`);
    }
    
    // If we have municipality_id but no city_id, that's fine - we'll use municipality directly
    if (municipality_id && !city_id) {
      console.log(`[discovery] Using municipality_id ${municipality_id} directly (no city mapping needed)`);
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

    // Get city name if city_id is provided (for logging)
    let cityName = 'Unknown';
    if (city_id) {
      const cities = await getCities();
      const city = cities.find((c) => String(c.id) === String(city_id));
      if (city) {
        cityName = city.name;
      }
    }

    console.log('[API] Starting discovery job for:', { 
      industry: industry.name, 
      municipality: municipalityName,
      city: cityName || 'N/A (using municipality directly)'
    });

    // Find or resolve dataset ID FIRST (before creating discovery_run)
    // dataset_id is optional - if not provided, find or create one
    // When using municipality_id, find a matching city or use a default
    let finalDatasetId = dataset_id;
    let datasetCityId = city_id;
    
    // If we have municipality_id but no city_id, try to find a matching city
    if (municipality_id && !datasetCityId) {
      console.log(`[API] Finding city for municipality_id ${municipality_id}...`);
      
      // Get municipality info
      const municipalityResult = await pool.query<{ descr: string; descr_en: string; prefecture_id: string }>(
        `SELECT descr, descr_en, prefecture_id FROM municipalities 
         WHERE id = $1 OR gemi_id = $2`,
        [municipality_id, municipality_id.replace('mun-', '')]
      );
      
      if (municipalityResult.rows.length > 0) {
        const municipality = municipalityResult.rows[0];
        
        // Try to find matching city by name
        const cityResult = await pool.query<{ id: string; name: string }>(
          `SELECT id, name FROM cities 
           WHERE name ILIKE $1 OR name ILIKE $2 OR normalized_name ILIKE $1 OR normalized_name ILIKE $2
           LIMIT 1`,
          [municipality.descr, municipality.descr_en]
        );
        
        if (cityResult.rows.length > 0) {
          datasetCityId = cityResult.rows[0].id;
          console.log(`[API] Found matching city: ${cityResult.rows[0].name} (${datasetCityId})`);
        } else {
          // Try to find any city in the same prefecture
          const prefectureCitiesResult = await pool.query<{ id: string; name: string }>(
            `SELECT c.id, c.name FROM cities c
             WHERE EXISTS (
               SELECT 1 FROM municipalities m 
               WHERE m.prefecture_id = $1 
               AND (m.descr ILIKE '%' || c.name || '%' OR c.name ILIKE '%' || m.descr || '%')
             )
             LIMIT 1`,
            [municipality.prefecture_id]
          );
          
          if (prefectureCitiesResult.rows.length > 0) {
            datasetCityId = prefectureCitiesResult.rows[0].id;
            console.log(`[API] Found city in same prefecture: ${prefectureCitiesResult.rows[0].name} (${datasetCityId})`);
          } else {
            // Last resort: use Athens as default
            const cities = await getCities();
            const athens = cities.find(c => 
              c.name.toLowerCase().includes('athens') || 
              c.name.toLowerCase().includes('αθήνα')
            );
            if (athens) {
              datasetCityId = athens.id;
              console.log(`[API] Using default city (Athens) for dataset: ${datasetCityId}`);
            }
          }
        }
      }
    }
    
    if (!finalDatasetId) {
      console.log('[API] dataset_id not provided, attempting to find existing dataset...');
      
      // If we have city_id (from municipality lookup or direct), use it for dataset lookup
      if (datasetCityId) {
        const existingDataset = await pool.query<{ id: string }>(
          `
          SELECT id FROM datasets
          WHERE user_id = $1
            AND city_id = $2
            AND industry_id = $3
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [userId, datasetCityId, industry_id!]
        );
        finalDatasetId = existingDataset.rows[0]?.id;
      }
      
      if (finalDatasetId) {
        console.log('[API] Found existing dataset:', finalDatasetId);
      }
    }

    // If dataset doesn't exist yet, create it synchronously so we can link discovery_run to it
    if (!finalDatasetId) {
      console.log('[API] Creating new dataset...');
      
      // When using municipality_gemi_id, we can create dataset with null city_id
      // Try to find a city if possible, but don't require it
      if (!datasetCityId) {
        console.log('[API] No city_id found, trying to use default city (Athens)...');
        const cities = await getCities();
        const athens = cities.find(c => 
          c.name.toLowerCase().includes('athens') || 
          c.name.toLowerCase().includes('αθήνα')
        );
        if (athens) {
          datasetCityId = athens.id;
          console.log(`[API] Using default city (Athens) for dataset: ${datasetCityId}`);
        } else {
          console.log('[API] Athens not found. Creating dataset with null city_id (using municipality_gemi_id directly).');
        }
      }
      
      // Create dataset - city_id can be null when using municipality_gemi_id
      if (datasetCityId) {
        const { resolveDataset } = await import('../services/datasetResolver.js');
        const resolverResult = await resolveDataset({
          userId,
          cityId: datasetCityId,
          industryId: industry.id,
        });
        finalDatasetId = resolverResult.dataset.id;
      } else {
        // Create dataset directly with null city_id (bypassing resolver which requires cityId)
        const { getOrCreateDataset } = await import('../db/datasets.js');
        const dataset = await getOrCreateDataset(
          userId,
          null, // city_id is null when using municipality_gemi_id directly
          industry.id,
          `Dataset ${municipality_gemi_id || municipality_id || 'unknown'}-${industry.id}`
        );
        finalDatasetId = dataset.id;
      }
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
    // Note: city_id matching is relaxed when using municipality_id
    if (dataset.industry_id !== industry.id) {
      console.error(`[API] Dataset industry mismatch detected:`);
      console.error(`[API]   Requested: industry_id=${industry.id} (${industry.name})`);
      console.error(`[API]   Dataset: industry_id=${dataset.industry_id}`);
      console.error(`[API]   Creating new dataset instead of reusing mismatched one...`);
      
      // Create a new dataset that matches the request
      const { resolveDataset: resolveDatasetForMismatch } = await import('../services/datasetResolver.js');
      
      // Use the datasetCityId we already resolved (from municipality or direct city_id)
      if (!datasetCityId) {
        throw new Error('Cannot create dataset: city_id is required.');
      }
      
      const resolverResult = await resolveDatasetForMismatch({
        userId,
        cityId: datasetCityId,
        industryId: industry.id,
      });
      finalDatasetId = resolverResult.dataset.id;
      console.log(`[API] Created new matching dataset: ${finalDatasetId}`);
      
      // Re-fetch the dataset to ensure we have the correct one
      const newDataset = await getDatasetById(finalDatasetId);
      if (!newDataset) {
        throw new Error(`Failed to create matching dataset`);
      }
      // Update dataset reference for rest of function
      Object.assign(dataset, newDataset);
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
    // Uses GEMI API as the discovery source
    // Extraction will happen in the background via extraction worker
    console.log('[API] Starting discovery job asynchronously...');
    console.log('[API] Discovery job params:', {
      userId,
      industry_id: industry.id,
      industry_gemi_id: industry_gemi_id,
      municipality_gemi_id: municipality_gemi_id,
      municipality_id: municipality_id || undefined,
      city_id: city_id || undefined,
      datasetId: finalDatasetId,
      discoveryRunId: discoveryRun.id
    });
    
    console.log('[API] About to call runDiscoveryJob...');
    console.log('🚨 ABOUT TO INSERT BUSINESSES - Discovery job starting');
    
    const jobPromise = runDiscoveryJob({
      userId,
      industry_id: industry.id, // Internal industry_id (resolved from gemi_id if needed)
      industry_gemi_id: industry_gemi_id, // GEMI industry ID (preferred)
      city_id: city_id || undefined, // Use city_id if available (for backward compatibility)
      municipality_id: municipality_id || undefined, // Internal municipality_id (resolved from gemi_id if needed)
      municipality_gemi_id: municipality_gemi_id, // GEMI municipality ID (preferred)
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
        c.name as city_name
      FROM discovery_runs dr
      JOIN datasets d ON d.id = dr.dataset_id
      LEFT JOIN industries i ON i.id = d.industry_id
      LEFT JOIN cities c ON c.id = d.city_id
      LEFT JOIN businesses b ON b.discovery_run_id = dr.id
      WHERE d.user_id = $1
      GROUP BY dr.id, dr.dataset_id, dr.status, dr.created_at, dr.completed_at, d.name, i.name, c.name
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
