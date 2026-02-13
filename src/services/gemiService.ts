/**
 * GEMI API Service
 * Handles fetching businesses from GEMI API with rate limiting
 * Rate limit: 8 requests per minute (7.5 second delay between calls)
 */

import axios, { AxiosInstance } from 'axios';
import { pool } from '../config/database.js';

const GEMI_API_BASE_URL = process.env.GEMI_API_BASE_URL || 'https://opendata-api.businessportal.gr/api/opendata/v1';
const GEMI_API_KEY = process.env.GEMI_API_KEY;

if (!GEMI_API_KEY) {
  console.warn('⚠️  WARNING: GEMI_API_KEY not set. GEMI API calls will fail.');
}

// Rate limiter: 8 requests per minute = 7.5 seconds between requests
const RATE_LIMIT_DELAY_MS = 7500; // 7.5 seconds

class RateLimiter {
  private lastRequestTime: number = 0;
  private pendingRequest: Promise<void> | null = null;

  async acquire(): Promise<void> {
    if (this.pendingRequest) {
      await this.pendingRequest;
    }

    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const delayNeeded = Math.max(0, RATE_LIMIT_DELAY_MS - timeSinceLastRequest);

    if (delayNeeded > 0) {
      this.pendingRequest = new Promise((resolve) => setTimeout(resolve, delayNeeded));
      await this.pendingRequest;
    }

    this.lastRequestTime = Date.now();
    this.pendingRequest = null;
  }
}

const rateLimiter = new RateLimiter();

// Axios client for GEMI API
const gemiClient: AxiosInstance = axios.create({
  baseURL: GEMI_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
  params: {}, // Will be populated per request
});

// Add API key to requests - use query parameter as per API documentation
gemiClient.interceptors.request.use((config) => {
  if (GEMI_API_KEY) {
    // Use api_key as query parameter (as per Postman test)
    config.params = config.params || {};
    config.params.api_key = GEMI_API_KEY;
  }
  return config;
});

export interface GemiCompany {
  ar_gemi: string; // Unique AR number
  name: string;
  legal_name?: string;
  municipality_id?: number;
  prefecture_id?: number;
  address?: string;
  postal_code?: string;
  website_url?: string;
  email?: string;
  phone?: string;
  activity_id?: number; // Industry/activity ID
  [key: string]: any; // Allow other fields from API
}

export interface GemiCompaniesResponse {
  data: GemiCompany[];
  totalCount: number;
  resultsOffset: number;
  hasMore: boolean;
}

/**
 * Fetch companies from GEMI API for a specific municipality
 * Automatically handles pagination
 */
export async function fetchGemiCompaniesForMunicipality(
  municipalityGemiId: number,
  activityId?: number
): Promise<GemiCompany[]> {
  if (!GEMI_API_KEY) {
    throw new Error('GEMI_API_KEY is not configured');
  }

  const allCompanies: GemiCompany[] = [];
  let resultsOffset = 0;
  let totalCount = 0;
  let hasMore = true;

  console.log(`[GEMI] Fetching companies for municipality ${municipalityGemiId}...`);

  while (hasMore) {
    // Acquire rate limiter lock
    await rateLimiter.acquire();

    try {
      const params: any = {
        municipalities: municipalityGemiId, // Use 'municipalities' (plural) as per API
        resultsOffset,
        resultsSize: 100, // Use 'resultsSize' instead of 'limit'
        resultsSortBy: '+arGemi', // Sort by AR GEMI ascending
      };

      if (activityId) {
        params.activities = activityId; // Use 'activities' (plural) if that's the correct param
      }

      console.log(`[GEMI] Fetching page at offset ${resultsOffset}...`);

      const response = await gemiClient.get<any>('/companies', { params });

      // Log response structure for debugging
      if (resultsOffset === 0 && response.data) {
        console.log(`[GEMI] API Response structure:`, JSON.stringify(Object.keys(response.data), null, 2));
        if (response.data.data && response.data.data.length > 0) {
          console.log(`[GEMI] First company structure:`, JSON.stringify(Object.keys(response.data.data[0]), null, 2));
          console.log(`[GEMI] First company sample:`, JSON.stringify(response.data.data[0], null, 2));
        }
      }

      // Map API response to our interface (handle both camelCase and snake_case)
      const rawCompanies = response.data.data || response.data || [];
      const companies: GemiCompany[] = rawCompanies.map((c: any) => ({
        ar_gemi: c.arGemi || c.ar_gemi || c.ar || null,
        name: c.name || c.companyName || c.legalName || 'Unknown',
        legal_name: c.legalName || c.legal_name || c.name,
        municipality_id: c.municipalityId || c.municipality_id || c.municipality || null,
        prefecture_id: c.prefectureId || c.prefecture_id || c.prefecture || null,
        address: c.address || c.fullAddress || null,
        postal_code: c.postalCode || c.postal_code || c.zipCode || null,
        website_url: c.websiteUrl || c.website_url || c.website || null,
        email: c.email || null,
        phone: c.phone || c.telephone || null,
        activity_id: c.activityId || c.activity_id || c.activity || null,
        ...c, // Include any other fields
      }));

      // Filter out companies without ar_gemi (required)
      const validCompanies = companies.filter(c => c.ar_gemi);
      if (validCompanies.length < companies.length) {
        console.warn(`[GEMI] Filtered out ${companies.length - validCompanies.length} companies without ar_gemi`);
      }

      totalCount = response.data.totalCount || response.data.total || validCompanies.length;
      
      allCompanies.push(...validCompanies);

      // Check if there are more results
      resultsOffset += validCompanies.length;
      hasMore = validCompanies.length > 0 && resultsOffset < totalCount;

      console.log(`[GEMI] Fetched ${validCompanies.length} companies (total: ${allCompanies.length}/${totalCount})`);

      // Safety check to prevent infinite loops
      if (resultsOffset >= 10000) {
        console.warn(`[GEMI] Reached safety limit of 10000 results, stopping pagination`);
        break;
      }
    } catch (error: any) {
      console.error(`[GEMI] Error fetching companies at offset ${resultsOffset}:`, error.message);
      if (error.response) {
        console.error(`[GEMI] Status: ${error.response.status}, Data:`, error.response.data);
      }
      throw error;
    }
  }

  console.log(`[GEMI] Completed fetching ${allCompanies.length} companies for municipality ${municipalityGemiId}`);
  return allCompanies;
}

/**
 * Import GEMI companies into database
 * Uses ar_gemi as unique constraint to prevent duplicates
 */
export async function importGemiCompaniesToDatabase(
  companies: GemiCompany[],
  datasetId: string,
  userId: string,
  cityId?: string, // Optional city_id to use if municipality mapping fails
  discoveryRunId?: string // Optional discovery_run_id to link businesses to discovery run
): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  console.log(`[GEMI] Starting import of ${companies.length} companies to database...`);
  
  for (const company of companies) {
    try {
      // Validate required field
      if (!company.ar_gemi) {
        console.warn(`[GEMI] Skipping company without ar_gemi:`, JSON.stringify(company));
        skipped++;
        continue;
      }

      // Get municipality_id and prefecture_id from GEMI IDs
      let municipalityId = null;
      let prefectureId = null;
      let industryId = null;

      if (company.municipality_id) {
        const municipalityResult = await pool.query(
          'SELECT id, prefecture_id FROM municipalities WHERE gemi_id = $1',
          [company.municipality_id]
        );
        if (municipalityResult.rows.length > 0) {
          municipalityId = municipalityResult.rows[0].id;
          prefectureId = municipalityResult.rows[0].prefecture_id;
        } else {
          console.warn(`[GEMI] Municipality with gemi_id ${company.municipality_id} not found in database`);
        }
      }

      if (company.activity_id) {
        const industryResult = await pool.query(
          'SELECT id FROM industries WHERE gemi_id = $1',
          [company.activity_id]
        );
        if (industryResult.rows.length > 0) {
          industryId = industryResult.rows[0].id;
        } else {
          console.warn(`[GEMI] Industry with gemi_id ${company.activity_id} not found in database`);
        }
      }

      // Get city_id from municipality (for backward compatibility)
      // Use provided cityId if available, otherwise try to match by municipality
      let finalCityId = cityId || null;
      if (!finalCityId && municipalityId) {
        // Try to find matching city by municipality name or use a default mapping
        const cityResult = await pool.query(
          `SELECT c.id FROM cities c
           JOIN municipalities m ON m.descr = c.name OR m.descr_en = c.name OR m.descr ILIKE c.name
           WHERE m.id = $1
           LIMIT 1`,
          [municipalityId]
        );
        finalCityId = cityResult.rows[0]?.id || null;
      }

      // Upsert business using ar_gemi as unique constraint
      const result = await pool.query(
        `INSERT INTO businesses (
          ar_gemi, name, address, postal_code, 
          municipality_id, prefecture_id, city_id, industry_id,
          website_url, dataset_id, owner_user_id, discovery_run_id, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        ON CONFLICT (ar_gemi) 
        DO UPDATE SET
          name = EXCLUDED.name,
          address = COALESCE(EXCLUDED.address, businesses.address),
          postal_code = COALESCE(EXCLUDED.postal_code, businesses.postal_code),
          municipality_id = COALESCE(EXCLUDED.municipality_id, businesses.municipality_id),
          prefecture_id = COALESCE(EXCLUDED.prefecture_id, businesses.prefecture_id),
          city_id = COALESCE(EXCLUDED.city_id, businesses.city_id),
          industry_id = COALESCE(EXCLUDED.industry_id, businesses.industry_id),
          website_url = COALESCE(EXCLUDED.website_url, businesses.website_url),
          discovery_run_id = COALESCE(EXCLUDED.discovery_run_id, businesses.discovery_run_id),
          updated_at = NOW()
        RETURNING id, (xmax = 0) AS inserted`,
        [
          company.ar_gemi,
          company.name || company.legal_name || 'Unknown',
          company.address || null,
          company.postal_code || null,
          municipalityId,
          prefectureId,
          finalCityId,
          industryId,
          company.website_url || null,
          datasetId,
          userId,
          discoveryRunId || null,
        ]
      );

      const businessId = result.rows[0]?.id;
      const wasInserted = result.rows[0]?.inserted;

      if (!businessId) {
        console.error(`[GEMI] Failed to insert/update business with ar_gemi: ${company.ar_gemi}`);
        skipped++;
        continue;
      }

      if (wasInserted) {
        inserted++;
        if (inserted % 10 === 0) {
          console.log(`[GEMI] Imported ${inserted} businesses so far...`);
        }
      } else {
        updated++;
      }

      // Insert website if provided
      if (company.website_url) {
        await pool.query(
          `INSERT INTO websites (business_id, url, created_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (business_id, url) DO NOTHING`,
          [businessId, company.website_url]
        );
      }

      // Insert contacts if provided
      if (company.email) {
        await pool.query(
          `INSERT INTO contacts (email, contact_type, created_at)
           VALUES ($1, 'email', NOW())
           ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
           RETURNING id`,
          [company.email]
        ).then(async (contactResult) => {
          if (contactResult.rows.length > 0) {
            await pool.query(
              `INSERT INTO contact_sources (business_id, contact_id, source_url, page_type, found_at)
               VALUES ($1, $2, $3, 'gemi_api', NOW())
               ON CONFLICT DO NOTHING`,
              [businessId, contactResult.rows[0].id, company.website_url || 'gemi_api']
            );
          }
        });
      }

      if (company.phone) {
        await pool.query(
          `INSERT INTO contacts (phone, contact_type, created_at)
           VALUES ($1, 'phone', NOW())
           ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
           RETURNING id`,
          [company.phone]
        ).then(async (contactResult) => {
          if (contactResult.rows.length > 0) {
            await pool.query(
              `INSERT INTO contact_sources (business_id, contact_id, source_url, page_type, found_at)
               VALUES ($1, $2, $3, 'gemi_api', NOW())
               ON CONFLICT DO NOTHING`,
              [businessId, contactResult.rows[0].id, company.website_url || 'gemi_api']
            );
          }
        });
      }
    } catch (error: any) {
      console.error(`[GEMI] Error importing company ${company.ar_gemi || 'unknown'}:`, error.message);
      if (error.code === '23505') { // Unique constraint violation
        console.warn(`[GEMI] Duplicate ar_gemi detected: ${company.ar_gemi}`);
        updated++; // Count as update instead of skip
      } else {
        skipped++;
      }
    }
  }

  console.log(`[GEMI] Import completed: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);
  return { inserted, updated, skipped };
}
