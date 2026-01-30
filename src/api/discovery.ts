import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { runDiscoveryJob } from '../services/discoveryService.js';
import { getIndustries } from '../db/industries.js';
import { getCities } from '../db/cities.js';
import { pool } from '../config/database.js';

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

    console.log('[API] Discovery request body:', JSON.stringify(req.body));
    console.log('[API] Discovery request:', { rawIndustryId, rawCityId, datasetId, userId, types: { industryId: typeof rawIndustryId, cityId: typeof rawCityId } });

    // Convert to numbers if they're strings
    const industryId = typeof rawIndustryId === 'string' ? parseInt(rawIndustryId, 10) : rawIndustryId;
    const cityId = typeof rawCityId === 'string' ? parseInt(rawCityId, 10) : rawCityId;

    // Validate required fields (explicitly check for null/undefined/NaN, not falsy values)
    if (industryId === undefined || industryId === null || isNaN(industryId) || cityId === undefined || cityId === null || isNaN(cityId)) {
      console.log('[API] Validation failed: missing or invalid industryId or cityId', { industryId, cityId });
      return res.status(400).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Missing or invalid required fields: industryId and cityId must be valid numbers',
        },
      });
    }

    // Get industry and city names from IDs
    const [industries, cities] = await Promise.all([
      getIndustries(),
      getCities(),
    ]);

    const industry = industries.find((i) => i.id === industryId);
    const city = cities.find((c) => c.id === cityId);

    if (!industry) {
      return res.status(400).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: `Industry with ID ${industryId} not found`,
        },
      });
    }

    if (!city) {
      return res.status(400).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: `City with ID ${cityId} not found`,
        },
      });
    }

    console.log('[API] Starting discovery job for:', { industry: industry.name, city: city.name });

    // Run discovery job asynchronously (don't wait for completion)
    // This allows the API to return immediately while discovery runs in background
    runDiscoveryJob({
      userId,
      industry: industry.name,
      city: city.name,
      latitude: city.latitude || undefined,
      longitude: city.longitude || undefined,
      useGeoGrid: true, // Use geo-grid discovery
      cityRadiusKm: city.radius_km || undefined,
      datasetId: datasetId || undefined,
    }).catch((error) => {
      // Log errors but don't block the response
      console.error('[API] Discovery job error:', error);
    });

    // Find or create dataset ID
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

    // Return success response immediately
    // Discovery is running in background, businesses will be available shortly
    return res.json({
      data: [], // Empty initially, will be populated by discovery
      meta: {
        plan_id: 'demo', // Will be set from user's plan
        gated: false,
        total_available: 0,
        total_returned: 0,
        message: 'Discovery started. Businesses will be available shortly. Please refresh the datasets page.',
      },
    });
  } catch (error: any) {
    console.error('[API] Error in discovery:', error);
    return res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to discover businesses',
      },
    });
  }
});

export default router;
