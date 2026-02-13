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
        console.log(`[GEMI] Full response sample (first 500 chars):`, JSON.stringify(response.data).substring(0, 500));
      }

      // Handle different API response structures
      // Structure 1: { data: [...], totalCount: ... }
      // Structure 2: { searchResults: [...], searchMetadata: {...} }
      // Structure 3: Direct array [...]
      let rawCompanies: any[] = [];
      
      if (Array.isArray(response.data)) {
        // Direct array
        rawCompanies = response.data;
        console.log(`[GEMI] Response is direct array with ${rawCompanies.length} items`);
      } else if (response.data?.data && Array.isArray(response.data.data)) {
        // Nested data array
        rawCompanies = response.data.data;
        totalCount = response.data.totalCount || response.data.total || rawCompanies.length;
        console.log(`[GEMI] Response has nested data array with ${rawCompanies.length} items, totalCount: ${totalCount}`);
      } else if (response.data?.searchResults && Array.isArray(response.data.searchResults)) {
        // searchResults structure
        rawCompanies = response.data.searchResults;
        if (response.data.searchMetadata) {
          totalCount = response.data.searchMetadata.totalCount || response.data.searchMetadata.total || rawCompanies.length;
          console.log(`[GEMI] Response has searchResults with ${rawCompanies.length} items, totalCount: ${totalCount}`);
        }
      } else if (response.data && typeof response.data === 'object') {
        // Try to find any array property
        const arrayKeys = Object.keys(response.data).filter(key => Array.isArray(response.data[key]));
        if (arrayKeys.length > 0) {
          rawCompanies = response.data[arrayKeys[0]];
          console.log(`[GEMI] Found array in key '${arrayKeys[0]}' with ${rawCompanies.length} items`);
        } else {
          console.error(`[GEMI] ❌ Could not find array in response:`, JSON.stringify(Object.keys(response.data)));
          throw new Error('Invalid API response structure: no array found');
        }
      }

      if (rawCompanies.length === 0) {
        console.warn(`[GEMI] ⚠️  No companies found in response at offset ${resultsOffset}`);
        hasMore = false;
        break;
      }

      // Log first company structure for debugging
      if (resultsOffset === 0 && rawCompanies.length > 0) {
        console.log(`[GEMI] First company structure:`, JSON.stringify(Object.keys(rawCompanies[0]), null, 2));
        console.log(`[GEMI] First company sample:`, JSON.stringify(rawCompanies[0], null, 2));
      }

      // Map API response to our interface (handle both camelCase and snake_case)
      const companies: GemiCompany[] = rawCompanies.map((c: any) => {
        // Handle municipality_id - can be number, string, or object with id property
        let municipalityId: number | null = null;
        if (c.municipalityId || c.municipality_id || c.municipality) {
          const mun = c.municipalityId || c.municipality_id || c.municipality;
          if (typeof mun === 'object' && mun !== null) {
            municipalityId = mun.id || mun.gemi_id || mun.gemiId || null;
          } else if (typeof mun === 'number' || typeof mun === 'string') {
            municipalityId = typeof mun === 'string' ? parseInt(mun, 10) : mun;
          }
        }

        // Handle prefecture_id - can be number, string, or object with id property
        let prefectureId: number | null = null;
        if (c.prefectureId || c.prefecture_id || c.prefecture) {
          const pref = c.prefectureId || c.prefecture_id || c.prefecture;
          if (typeof pref === 'object' && pref !== null) {
            prefectureId = pref.id || pref.gemi_id || pref.gemiId || null;
          } else if (typeof pref === 'number' || typeof pref === 'string') {
            prefectureId = typeof pref === 'string' ? parseInt(pref, 10) : pref;
          }
        }

        // Handle activity_id - can be number, string, or object with id property
        let activityId: number | null = null;
        if (c.activityId || c.activity_id || c.activity) {
          const act = c.activityId || c.activity_id || c.activity;
          if (typeof act === 'object' && act !== null) {
            activityId = act.id || act.gemi_id || act.gemiId || null;
          } else if (typeof act === 'number' || typeof act === 'string') {
            activityId = typeof act === 'string' ? parseInt(act, 10) : act;
          }
        }

        // Get business name from coNamesEn (English) or coNameEl (Greek)
        // Handle arrays - take first element if it's an array
        let businessName = 'Unknown';
        if (c.coNamesEn) {
          businessName = Array.isArray(c.coNamesEn) ? (c.coNamesEn[0] || 'Unknown') : c.coNamesEn;
        } else if (c.coNameEl) {
          businessName = Array.isArray(c.coNameEl) ? (c.coNameEl[0] || 'Unknown') : c.coNameEl;
        } else if (c.name) {
          businessName = Array.isArray(c.name) ? (c.name[0] || 'Unknown') : c.name;
        } else if (c.companyName) {
          businessName = Array.isArray(c.companyName) ? (c.companyName[0] || 'Unknown') : c.companyName;
        } else if (c.legalName) {
          businessName = Array.isArray(c.legalName) ? (c.legalName[0] || 'Unknown') : c.legalName;
        }

        return {
          ar_gemi: c.arGemi || c.ar_gemi || c.ar || String(c.arGemi || c.ar_gemi || c.ar || ''),
          name: businessName,
          legal_name: c.legalName || c.legal_name || businessName,
          municipality_id: municipalityId,
          prefecture_id: prefectureId,
          address: c.address || c.fullAddress || null,
          postal_code: c.postalCode || c.postal_code || c.zipCode || null,
          website_url: c.websiteUrl || c.website_url || c.website || null,
          email: c.email || null,
          phone: c.phone || c.telephone || null,
          activity_id: activityId,
          ...c, // Include any other fields
        };
      });

      // Filter out companies without ar_gemi (required)
      const validCompanies = companies.filter(c => c.ar_gemi);
      if (validCompanies.length < companies.length) {
        console.warn(`[GEMI] Filtered out ${companies.length - validCompanies.length} companies without ar_gemi`);
      }

      totalCount = response.data.totalCount || response.data.total || validCompanies.length;
      
      allCompanies.push(...validCompanies);

      // Update totalCount if we got it from response
      if (response.data?.searchMetadata?.totalCount) {
        totalCount = response.data.searchMetadata.totalCount;
      } else if (response.data?.totalCount) {
        totalCount = response.data.totalCount;
      } else if (response.data?.total) {
        totalCount = response.data.total;
      }

      // Check if there are more results
      resultsOffset += validCompanies.length;
      hasMore = validCompanies.length > 0 && (totalCount === 0 || resultsOffset < totalCount);

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
  discoveryRunId?: string // Optional discovery_run_id to link businesses to discovery run
): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  console.log(`\n[GEMI] ========== STARTING IMPORT ==========`);
  console.log(`[GEMI] Total companies to import: ${companies.length}`);
  console.log(`[GEMI] Dataset ID: ${datasetId}`);
  console.log(`[GEMI] User ID: ${userId}`);
  console.log(`[GEMI] Discovery Run ID: ${discoveryRunId || 'none'}`);
  
  if (companies.length === 0) {
    console.warn(`[GEMI] ⚠️  No companies to import!`);
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  
  // Log first company structure for debugging
  console.log(`[GEMI] First company structure:`, JSON.stringify({
    ar_gemi: companies[0].ar_gemi,
    name: companies[0].name,
    municipality_id: companies[0].municipality_id,
    activity_id: companies[0].activity_id,
    has_address: !!companies[0].address,
    has_website: !!companies[0].website_url,
  }, null, 2));
  
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    // Declare variables in outer scope for error handling
      let municipalityId: string | null = null;
      let prefectureId: string | null = null;
    
    try {
      // Validate required field
      if (!company.ar_gemi) {
        console.warn(`[GEMI] [${i + 1}/${companies.length}] ⚠️  Skipping company without ar_gemi:`, JSON.stringify({
          name: company.name,
          legal_name: company.legal_name,
          keys: Object.keys(company),
        }));
        skipped++;
        continue;
      }
      
      if ((i + 1) % 50 === 0 || i === 0) {
        console.log(`[GEMI] [${i + 1}/${companies.length}] Processing: ${company.ar_gemi} - ${company.name || company.legal_name || 'Unknown'}`);
      }

      // Get municipality_id and prefecture_id from GEMI IDs

      // Lookup municipality - handle both number and string gemi_id
      if (company.municipality_id) {
        // Convert to string for database lookup (gemi_id is stored as TEXT)
        const municipalityGemiId = String(company.municipality_id);
        const municipalityResult = await pool.query(
          'SELECT id, prefecture_id, descr, descr_en, gemi_id FROM municipalities WHERE gemi_id = $1',
          [municipalityGemiId]
        );
        if (municipalityResult.rows.length > 0) {
          municipalityId = municipalityResult.rows[0].id;
          prefectureId = municipalityResult.rows[0].prefecture_id;
          if (i < 5) { // Log first 5 for debugging
            console.log(`[GEMI] Found municipality: ${municipalityResult.rows[0].descr} (gemi_id: ${municipalityResult.rows[0].gemi_id}, ID: ${municipalityId}, Prefecture: ${prefectureId})`);
          }
        } else {
          console.warn(`[GEMI] ⚠️  Municipality with gemi_id ${municipalityGemiId} (type: ${typeof company.municipality_id}) not found in database for company ${company.ar_gemi}`);
          if (i < 5) {
            console.log(`[GEMI] Company municipality_id value:`, JSON.stringify(company.municipality_id));
          }
        }
      } else {
        if (i < 5) {
          console.log(`[GEMI] Company ${company.ar_gemi} has no municipality_id`);
        }
      }

      // Note: industry_id column has been removed from businesses table
      // Industry filtering is now done through dataset_id -> datasets.industry_id relationship
      // We still log activity_id for debugging but don't store it in businesses table
      if (company.activity_id && i < 5) {
        const industryResult = await pool.query(
          'SELECT name FROM industries WHERE gemi_id = $1',
          [company.activity_id]
        );
        if (industryResult.rows.length > 0) {
          console.log(`[GEMI] Company ${company.ar_gemi} has activity_id ${company.activity_id} (${industryResult.rows[0].name}) - stored via dataset`);
        }
      }

      // Prepare insert values (city_id and industry_id removed)
      // Use company.name which should already have coNamesEn or coNameEl from mapping
      const insertValues = [
        company.ar_gemi,
        company.name || 'Unknown',
        company.address || null,
        company.postal_code || null,
        municipalityId,
        prefectureId,
        company.website_url || null,
        datasetId,
        userId,
        discoveryRunId || null,
      ];
      
      if (i < 3) { // Log first 3 inserts in detail
        console.log(`[GEMI] Insert values for ${company.ar_gemi}:`, {
          ar_gemi: insertValues[0],
          name: insertValues[1],
          municipality_id: insertValues[4],
          prefecture_id: insertValues[5],
          dataset_id: insertValues[7],
          discovery_run_id: insertValues[9],
        });
      }

      // Upsert business using ar_gemi as unique constraint
      // Minimum required fields only: ar_gemi, name, dataset_id, owner_user_id
      // Optional fields: address, postal_code, municipality_id, prefecture_id, website_url, discovery_run_id
      const result = await pool.query(
        `INSERT INTO businesses (
          ar_gemi, name, address, postal_code, 
          municipality_id, prefecture_id,
          website_url, dataset_id, owner_user_id, discovery_run_id, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        ON CONFLICT (ar_gemi) 
        DO UPDATE SET
          name = EXCLUDED.name,
          address = COALESCE(EXCLUDED.address, businesses.address),
          postal_code = COALESCE(EXCLUDED.postal_code, businesses.postal_code),
          municipality_id = COALESCE(EXCLUDED.municipality_id, businesses.municipality_id),
          prefecture_id = COALESCE(EXCLUDED.prefecture_id, businesses.prefecture_id),
          website_url = COALESCE(EXCLUDED.website_url, businesses.website_url),
          discovery_run_id = COALESCE(EXCLUDED.discovery_run_id, businesses.discovery_run_id),
          updated_at = NOW()
        RETURNING id, (xmax = 0) AS inserted`,
        insertValues
      );

      const businessId = result.rows[0]?.id;
      const wasInserted = result.rows[0]?.inserted;

      if (!businessId) {
        console.error(`[GEMI] ❌ Failed to insert/update business with ar_gemi: ${company.ar_gemi}`);
        console.error(`[GEMI] Query returned:`, result.rows);
        skipped++;
        continue;
      }

      if (wasInserted) {
        inserted++;
        if (inserted % 10 === 0 || inserted <= 3) {
          console.log(`[GEMI] ✅ Inserted business #${inserted}: ${company.ar_gemi} (ID: ${businessId})`);
        }
      } else {
        updated++;
        if (updated <= 3) {
          console.log(`[GEMI] 🔄 Updated business: ${company.ar_gemi} (ID: ${businessId})`);
        }
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
      console.error(`[GEMI] ❌ Error importing company [${i + 1}/${companies.length}] ${company.ar_gemi || 'unknown'}:`, error.message);
      if (error.code) {
        console.error(`[GEMI] Error code: ${error.code}`);
      }
      if (error.detail) {
        console.error(`[GEMI] Error detail: ${error.detail}`);
      }
      if (error.hint) {
        console.error(`[GEMI] Error hint: ${error.hint}`);
      }
      if (error.stack && i < 3) {
        console.error(`[GEMI] Stack trace:`, error.stack);
      }
      
      if (error.code === '23505') { // Unique constraint violation
        console.warn(`[GEMI] ⚠️  Duplicate ar_gemi detected: ${company.ar_gemi} (counting as update)`);
        updated++; // Count as update instead of skip
      } else if (error.code === '23503') { // Foreign key violation
        console.error(`[GEMI] ❌ Foreign key violation for ${company.ar_gemi}:`, {
          municipality_id: municipalityId,
          prefecture_id: prefectureId,
          dataset_id: datasetId,
        });
        skipped++;
      } else {
        skipped++;
      }
    }
  }

  console.log(`\n[GEMI] ========== IMPORT SUMMARY ==========`);
  console.log(`[GEMI] ✅ Inserted: ${inserted}`);
  console.log(`[GEMI] 🔄 Updated: ${updated}`);
  console.log(`[GEMI] ⏭️  Skipped: ${skipped}`);
  console.log(`[GEMI] 📊 Total processed: ${inserted + updated + skipped} / ${companies.length}`);
  console.log(`[GEMI] ======================================\n`);
  
  return { inserted, updated, skipped };
}
