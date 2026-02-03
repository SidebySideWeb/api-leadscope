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

    // Run discovery job and WAIT for completion
    // This ensures businesses are created before we proceed
    console.log('[API] Running discovery job and waiting for completion...');
    await runDiscoveryJob({
      userId,
      industry_id: industry.id, // Use industry_id for keyword-based discovery
      city_id: city.id, // Use city_id for coordinate-based discovery
      latitude: city.latitude || undefined,
      longitude: city.longitude || undefined,
      useGeoGrid: false, // Don't use geo-grid - use keyword fan-out instead
      cityRadiusKm: city.radius_km || undefined,
      datasetId: finalDatasetId, // Use resolved dataset ID
      discoveryRunId: discoveryRun.id, // Pass discovery_run_id to link businesses
    });

    console.log('[API] Discovery completed. Waiting for extraction to finish...');

    // Wait for all extraction jobs to complete for this discovery run
    const { getExtractionJobsByDiscoveryRunId } = await import('../db/extractionJobs.js');
    const MAX_WAIT_TIME = 300000; // 5 minutes max wait
    const POLL_INTERVAL = 2000; // Check every 2 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_WAIT_TIME) {
      const extractionJobs = await getExtractionJobsByDiscoveryRunId(discoveryRun.id);
      
      if (extractionJobs.length === 0) {
        // No extraction jobs - discovery found no businesses or jobs already processed
        console.log('[API] No extraction jobs found for discovery_run');
        break;
      }

      // Check if all jobs are completed (success or failed)
      const pendingJobs = extractionJobs.filter(job => 
        job.status === 'pending' || job.status === 'running'
      );

      if (pendingJobs.length === 0) {
        console.log(`[API] All ${extractionJobs.length} extraction jobs completed`);
        break;
      }

      console.log(`[API] Waiting for ${pendingJobs.length} extraction jobs to complete...`);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    // Fetch businesses with contact details for this discovery run
    console.log('[API] Fetching businesses with contact details...');
    const businessesResult = await pool.query<{
      id: number;
      name: string;
      address: string | null;
      postal_code: string | null;
      city_id: string;
      industry_id: string | null;
      google_place_id: string | null;
      dataset_id: string;
      owner_user_id: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT b.id, b.name, b.address, b.postal_code, b.city_id, b.industry_id, 
              b.google_place_id, b.dataset_id, b.owner_user_id, b.created_at, b.updated_at
       FROM businesses b
       WHERE b.discovery_run_id = $1
       ORDER BY b.created_at DESC`,
      [discoveryRun.id]
    );

    // Get websites for businesses
    const businessIds = businessesResult.rows.map(b => b.id);
    let websites: { business_id: number; url: string }[] = [];
    let contacts: { business_id: number; email: string | null; phone: string | null }[] = [];

    if (businessIds.length > 0) {
      // Get websites
      const websitesResult = await pool.query<{ business_id: number; url: string }>(
        `SELECT business_id, url FROM websites WHERE business_id = ANY($1)`,
        [businessIds]
      );
      websites = websitesResult.rows;

      // Get contacts (email and phone) - use business_id if available, otherwise fallback to website join
      const contactsResult = await pool.query<{
        business_id: number;
        email: string | null;
        phone: string | null;
      }>(
        `SELECT DISTINCT ON (COALESCE(cs.business_id, w.business_id), c.contact_type)
           COALESCE(cs.business_id, w.business_id) as business_id,
           CASE WHEN c.contact_type = 'email' THEN c.email ELSE NULL END as email,
           CASE WHEN c.contact_type = 'phone' THEN COALESCE(c.phone, c.mobile) ELSE NULL END as phone
         FROM contacts c
         JOIN contact_sources cs ON cs.contact_id = c.id
         LEFT JOIN websites w ON (
           cs.business_id IS NULL 
           AND (
             cs.source_url LIKE '%' || REPLACE(REPLACE(w.url, 'https://', ''), 'http://', '') || '%'
             OR cs.source_url = w.url
             OR cs.source_url LIKE w.url || '%'
           )
         )
         WHERE (cs.business_id = ANY($1) OR w.business_id = ANY($1))
           AND (c.email IS NOT NULL OR c.phone IS NOT NULL OR c.mobile IS NOT NULL)
         ORDER BY COALESCE(cs.business_id, w.business_id), c.contact_type, cs.found_at ASC`,
        [businessIds]
      );

      // Aggregate contacts per business
      const contactMap = new Map<number, { email: string | null; phone: string | null }>();
      for (const row of contactsResult.rows) {
        if (!contactMap.has(row.business_id)) {
          contactMap.set(row.business_id, { email: null, phone: null });
        }
        const contact = contactMap.get(row.business_id)!;
        if (row.email && !contact.email) {
          contact.email = row.email;
        }
        if (row.phone && !contact.phone) {
          contact.phone = row.phone;
        }
      }
      contacts = Array.from(contactMap.entries()).map(([business_id, contact]) => ({
        business_id,
        ...contact,
      }));
    }

    const websiteMap = new Map(websites.map(w => [w.business_id, w.url]));
    const contactMap = new Map(contacts.map(c => [c.business_id, c]));

    // Map to frontend format
    const businesses = businessesResult.rows.map((b) => {
      const contact = contactMap.get(b.id);
      return {
        id: b.id.toString(),
        name: b.name,
        address: b.address,
        website: websiteMap.get(b.id) || null,
        email: contact?.email || null,
        phone: contact?.phone || null,
        city: city.name,
        industry: industry.name,
        lastVerifiedAt: null,
        isActive: true,
      };
    });

    console.log(`[API] Returning ${businesses.length} businesses with contact details`);

    // Return businesses with contact details
    return res.json({
      data: businesses,
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: businesses.length,
        total_returned: businesses.length,
        message: `Discovery completed. Found ${businesses.length} businesses with contact details.`,
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
