import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import { verifyDatasetOwnership } from '../db/datasets.js';

const router = express.Router();

/**
 * GET /businesses
 * Get businesses for a dataset (must belong to authenticated user)
 * Query params: datasetId (required), page, limit, search
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const datasetId = req.query.datasetId as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = req.query.search as string | undefined;

    if (!datasetId) {
      return res.status(400).json({
        data: [],
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'datasetId is required',
        },
      });
    }

    // Verify dataset ownership
    const ownsDataset = await verifyDatasetOwnership(datasetId, userId);
    if (!ownsDataset) {
      return res.status(403).json({
        data: [],
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Dataset not found or access denied',
        },
      });
    }

    // Build query
    // Note: city_id and industry_id are on datasets table, not businesses
    // website_url, phone, and email are now directly on businesses table
    let query = `
      SELECT 
        b.id,
        b.name,
        b.address,
        b.postal_code,
        b.dataset_id,
        b.owner_user_id,
        b.created_at,
        b.updated_at,
        b.website_url,
        b.phone,
        b.email,
        d.city_id,
        d.industry_id,
        c.name as city_name,
        i.name as industry_name
      FROM businesses b
      LEFT JOIN datasets d ON d.id = b.dataset_id
      LEFT JOIN cities c ON c.id = d.city_id
      LEFT JOIN industries i ON i.id = d.industry_id
      WHERE b.dataset_id = $1
    `;
    const params: any[] = [datasetId];

    // Add search filter if provided
    if (search) {
      query += ' AND (b.name ILIKE $2 OR b.address ILIKE $2)';
      params.push(`%${search}%`);
    }

    // Get total count
    const countQuery = query.replace(
      /SELECT[\s\S]*?FROM businesses b/s,
      'SELECT COUNT(*) as total FROM businesses b'
    );
    const countResult = await pool.query<{ total: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    // Add pagination
    const offset = (page - 1) * limit;
    query += ` ORDER BY b.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    // Execute query
    const result = await pool.query<{
      id: string;
      name: string;
      address: string | null;
      postal_code: string | null;
      dataset_id: string;
      owner_user_id: string;
      created_at: Date;
      updated_at: Date;
      website_url: string | null;
      phone: string | null;
      email: string | null;
      city_id: string | null;
      industry_id: string | null;
      city_name: string | null;
      industry_name: string | null;
    }>(query, params);

    // Get user's plan
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

    // Map to frontend format
    const businesses = result.rows.map((b) => {
      return {
        id: b.id,
        name: b.name,
        address: b.address,
        website: b.website_url || null,
        email: b.email || null,
        phone: b.phone || null,
        city: b.city_name || 'Unknown',
        industry: b.industry_name || 'Unknown',
        lastVerifiedAt: null,
        isActive: true,
      };
    });

    return res.json({
      data: businesses,
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: total,
        total_returned: businesses.length,
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching businesses:', error);
    return res.status(500).json({
      data: [],
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch businesses',
      },
    });
  }
});

/**
 * GET /businesses/dataset/:datasetId/contacts
 * Get all businesses with detailed contacts for a dataset (optimized batch query)
 */
router.get('/dataset/:datasetId/contacts', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const datasetId = Array.isArray(req.params.datasetId) ? req.params.datasetId[0] : req.params.datasetId;

    if (!datasetId) {
      return res.status(400).json({
        data: [],
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'datasetId is required',
        },
      });
    }

    // Verify dataset ownership
    const ownsDataset = await verifyDatasetOwnership(datasetId, userId);
    if (!ownsDataset) {
      return res.status(403).json({
        data: [],
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Dataset not found or access denied',
        },
      });
    }

    // Get all businesses for this dataset
    const businessesResult = await pool.query<{
      id: string;
      name: string;
      address: string | null;
      postal_code: string | null;
      created_at: Date;
    }>(
      `SELECT id, name, address, postal_code, created_at
       FROM businesses
       WHERE dataset_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [datasetId]
    );

    const businessIds = businessesResult.rows.map(b => b.id);

    if (businessIds.length === 0) {
      // Get user's plan
      const userResult = await pool.query<{ plan: string }>(
        'SELECT plan FROM users WHERE id = $1',
        [userId]
      );
      const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

      return res.json({
        data: [],
        meta: {
          plan_id: userPlan,
          gated: false,
          total_available: 0,
          total_returned: 0,
        },
      });
    }

    // Get websites
    const websitesResult = await pool.query<{ business_id: string; url: string }>(
      'SELECT business_id, url FROM websites WHERE business_id = ANY($1)',
      [businessIds]
    );
    const websiteMap = new Map(websitesResult.rows.map(w => [w.business_id, w.url]));

    // Get ALL contacts for these businesses
    const contactsResult = await pool.query<{
      business_id: string;
      contact_id: number;
      email: string | null;
      phone: string | null;
      mobile: string | null;
      source_url: string;
      page_type: string;
      found_at: Date;
    }>(
      `SELECT 
        cs.business_id,
        c.id as contact_id,
        c.email,
        c.phone,
        c.mobile,
        cs.source_url,
        cs.page_type,
        cs.found_at
      FROM contacts c
      JOIN contact_sources cs ON cs.contact_id = c.id
      WHERE cs.business_id = ANY($1)
      ORDER BY cs.business_id, cs.found_at DESC`,
      [businessIds]
    );

    // Get extraction jobs
    const extractionJobsResult = await pool.query<{
      business_id: string;
      id: string;
      status: string;
      completed_at: Date | null;
    }>(
      `SELECT business_id, id, status, completed_at
       FROM extraction_jobs
       WHERE business_id = ANY($1)
       ORDER BY created_at DESC`,
      [businessIds]
    );

    // Group contacts by business
    const contactsByBusiness = new Map<string, {
      emails: Array<{ id: number; email: string; source_url: string; page_type: string; found_at: string }>;
      phones: Array<{ id: number; phone: string; source_url: string; page_type: string; found_at: string }>;
    }>();

    for (const contact of contactsResult.rows) {
      if (!contactsByBusiness.has(contact.business_id)) {
        contactsByBusiness.set(contact.business_id, { emails: [], phones: [] });
      }
      const businessContacts = contactsByBusiness.get(contact.business_id)!;

      if (contact.email) {
        businessContacts.emails.push({
          id: contact.contact_id,
          email: contact.email,
          source_url: contact.source_url,
          page_type: contact.page_type,
          found_at: contact.found_at instanceof Date ? contact.found_at.toISOString() : contact.found_at,
        });
      }

      if (contact.phone || contact.mobile) {
        businessContacts.phones.push({
          id: contact.contact_id,
          phone: contact.phone || contact.mobile!,
          source_url: contact.source_url,
          page_type: contact.page_type,
          found_at: contact.found_at instanceof Date ? contact.found_at.toISOString() : contact.found_at,
        });
      }
    }

    // Group extraction jobs by business (get latest)
    const extractionJobMap = new Map<string, { id: string; status: string; completed_at: string | null }>();
    for (const job of extractionJobsResult.rows) {
      if (!extractionJobMap.has(job.business_id)) {
        extractionJobMap.set(job.business_id, {
          id: job.id,
          status: job.status,
          completed_at: job.completed_at instanceof Date ? job.completed_at.toISOString() : job.completed_at,
        });
      }
    }

    // Get user's plan
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

    // Build response
    const businesses = businessesResult.rows.map(business => {
      const contacts = contactsByBusiness.get(business.id) || { emails: [], phones: [] };
      const extractionJob = extractionJobMap.get(business.id) || null;

      return {
        id: business.id,
        name: business.name,
        address: business.address,
        website: websiteMap.get(business.id) || null,
        emails: contacts.emails,
        phones: contacts.phones,
        extraction_job: extractionJob,
      };
    });

    return res.json({
      data: businesses,
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: businesses.length,
        total_returned: businesses.length,
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching business contacts:', error);
    return res.status(500).json({
      data: [],
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch business contacts',
      },
    });
  }
});

/**
 * GET /businesses/:id
 * Get detailed business data including all contacts and social media
 */
router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const businessId = req.params.id;

    // Get business and verify ownership
    const businessResult = await pool.query<{
      id: string;
      name: string;
      address: string | null;
      postal_code: string | null;
      dataset_id: string;
      owner_user_id: string;
      created_at: Date;
      updated_at: Date;
      website_url: string | null;
      phone: string | null;
      email: string | null;
      city_id: string | null;
      industry_id: string | null;
      city_name: string | null;
      industry_name: string | null;
    }>(
      `SELECT 
        b.id,
        b.name,
        b.address,
        b.postal_code,
        b.dataset_id,
        b.owner_user_id,
        b.created_at,
        b.updated_at,
        b.website_url,
        b.phone,
        b.email,
        d.city_id,
        d.industry_id,
        c.name as city_name,
        i.name as industry_name
      FROM businesses b
      LEFT JOIN datasets d ON d.id = b.dataset_id
      LEFT JOIN cities c ON c.id = d.city_id
      LEFT JOIN industries i ON i.id = d.industry_id
      WHERE b.id = $1`,
      [businessId]
    );

    if (businessResult.rows.length === 0) {
      return res.status(404).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Business not found',
        },
      });
    }

    const business = businessResult.rows[0];

    // Verify dataset ownership
    const ownsDataset = await verifyDatasetOwnership(business.dataset_id, userId);
    if (!ownsDataset) {
      return res.status(403).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Access denied',
        },
      });
    }

    // Get website - now stored directly on businesses table
    const website = business.website_url || null;

    // Get ALL contacts for this business
    const contactsResult = await pool.query<{
      id: number;
      email: string | null;
      phone: string | null;
      mobile: string | null;
      contact_type: string;
      source_url: string;
      page_type: string;
      found_at: Date;
    }>(
      `SELECT 
        c.id,
        c.email,
        c.phone,
        c.mobile,
        c.contact_type,
        cs.source_url,
        cs.page_type,
        cs.found_at
      FROM contacts c
      JOIN contact_sources cs ON cs.contact_id = c.id
      WHERE cs.business_id = $1
      ORDER BY cs.found_at DESC`,
      [businessId]
    );

    // Get social media links
    let socialMedia: { platform: string; url: string }[] = [];
    try {
      const socialResult = await pool.query<{ platform: string; url: string }>(
        'SELECT platform, url FROM social_media WHERE business_id = $1',
        [businessId]
      );
      socialMedia = socialResult.rows;
    } catch (error: any) {
      // Table might not exist, that's okay
      if (error.code !== '42P01') {
        console.error('[API] Error fetching social media:', error);
      }
    }

    // Get extraction job status
    const extractionJobResult = await pool.query<{
      id: string;
      status: string;
      error_message: string | null;
      created_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
    }>(
      'SELECT id, status, error_message, created_at, started_at, completed_at FROM extraction_jobs WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1',
      [businessId]
    );

    // Get user's plan
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

    // Group contacts by type
    const emails = contactsResult.rows
      .filter(c => c.email)
      .map(c => ({
        id: c.id,
        email: c.email!,
        source_url: c.source_url,
        page_type: c.page_type,
        found_at: c.found_at instanceof Date ? c.found_at.toISOString() : c.found_at,
      }));

    const phones = contactsResult.rows
      .filter(c => c.phone || c.mobile)
      .map(c => ({
        id: c.id,
        phone: c.phone || c.mobile!,
        source_url: c.source_url,
        page_type: c.page_type,
        found_at: c.found_at instanceof Date ? c.found_at.toISOString() : c.found_at,
      }));

    return res.json({
      data: {
        id: business.id,
        name: business.name,
        address: business.address,
        postal_code: business.postal_code,
        city: business.city_name || 'Unknown',
        industry: business.industry_name || 'Unknown',
        website: website,
        emails: emails,
        phones: phones,
        social_media: socialMedia.reduce((acc, sm) => {
          acc[sm.platform] = sm.url;
          return acc;
        }, {} as Record<string, string>),
        extraction_job: extractionJobResult.rows[0] ? {
          id: extractionJobResult.rows[0].id,
          status: extractionJobResult.rows[0].status,
          error_message: extractionJobResult.rows[0].error_message,
          created_at: extractionJobResult.rows[0].created_at instanceof Date 
            ? extractionJobResult.rows[0].created_at.toISOString() 
            : extractionJobResult.rows[0].created_at,
          started_at: extractionJobResult.rows[0].started_at instanceof Date 
            ? extractionJobResult.rows[0].started_at.toISOString() 
            : extractionJobResult.rows[0].started_at,
          completed_at: extractionJobResult.rows[0].completed_at instanceof Date 
            ? extractionJobResult.rows[0].completed_at.toISOString() 
            : extractionJobResult.rows[0].completed_at,
        } : null,
        created_at: business.created_at instanceof Date ? business.created_at.toISOString() : business.created_at,
        updated_at: business.updated_at instanceof Date ? business.updated_at.toISOString() : business.updated_at,
      },
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: 1,
        total_returned: 1,
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching business details:', error);
    return res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch business details',
      },
    });
  }
});

export default router;
