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
    const { industryId, cityId, datasetId } = req.body;

    // Validate required fields
    if (!industryId || !cityId) {
      return res.status(400).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Missing required fields: industryId and cityId are required',
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

    // Run discovery job
    const jobResult = await runDiscoveryJob({
      userId,
      industry: industry.name,
      city: city.name,
      latitude: city.latitude || undefined,
      longitude: city.longitude || undefined,
      useGeoGrid: true, // Use geo-grid discovery
      cityRadiusKm: city.radius_km || undefined,
      datasetId: datasetId || undefined,
    });

    // If gated, return error with upgrade hint
    if (jobResult.gated) {
      return res.status(403).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: true,
          total_available: 0,
          total_returned: 0,
          gate_reason: jobResult.upgrade_hint || 'Discovery limit reached',
        },
      });
    }

    // If there were errors, return them
    if (jobResult.errors && jobResult.errors.length > 0) {
      return res.status(500).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: jobResult.errors.join('; '),
        },
      });
    }

    // Get businesses from the dataset
    // If datasetId was provided, use it; otherwise we need to find the dataset
    let finalDatasetId = datasetId;
    if (!finalDatasetId) {
      // Find the dataset that was created/reused
      const datasetResult = await pool.query<{ id: string }>(
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
      finalDatasetId = datasetResult.rows[0]?.id;
    }

    if (!finalDatasetId) {
      return res.status(500).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Failed to find dataset after discovery',
        },
      });
    }

    // Get businesses from the dataset with city and industry names
    const businessesResult = await pool.query<{
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
    }>(
      `
      SELECT b.* FROM businesses b
      WHERE b.dataset_id = $1
      ORDER BY b.created_at DESC
      LIMIT 100
      `,
      [finalDatasetId]
    );

    // Map businesses to frontend format
    const businesses = businessesResult.rows.map((b) => ({
      id: b.id.toString(), // Convert to string for frontend
      name: b.name,
      address: b.address,
      website: null, // Will be populated after crawl
      email: null, // Will be populated after crawl
      phone: null, // Will be populated after crawl
      city: city.name, // Use city name, not ID
      industry: industry.name, // Use industry name, not ID
      lastVerifiedAt: null, // Not available from discovery
      isActive: true, // Default to active
    }));

    return res.json({
      data: businesses,
      meta: {
        plan_id: 'demo', // Will be set from user's plan
        gated: false,
        total_available: businesses.length,
        total_returned: businesses.length,
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
