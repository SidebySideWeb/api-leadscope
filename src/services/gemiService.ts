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

// Rate limiter: 5 requests per minute = 12 seconds between requests (more conservative)
// After 5 calls, wait 60 seconds before continuing
const RATE_LIMIT_DELAY_MS = 12000; // 12 seconds between calls (more conservative)
const RATE_LIMIT_CALLS_PER_WINDOW = 5; // 5 calls per window (reduced from 8 to avoid 429 errors)
const RATE_LIMIT_WINDOW_RESET_MS = 60000; // 60 seconds to reset the window

class RateLimiter {
  private lastRequestTime: number = 0;
  private pendingRequest: Promise<void> | null = null;
  private callCount: number = 0;
  private windowStartTime: number = Date.now();

  async acquire(): Promise<void> {
    if (this.pendingRequest) {
      await this.pendingRequest;
    }

    const now = Date.now();
    const timeSinceWindowStart = now - this.windowStartTime;

    // Reset window if 60 seconds have passed
    if (timeSinceWindowStart >= RATE_LIMIT_WINDOW_RESET_MS) {
      this.callCount = 0;
      this.windowStartTime = now;
      console.log(`[GEMI Rate Limiter] Window reset after ${timeSinceWindowStart}ms`);
    }

    // If we've made 8 calls in this window, wait until the window resets
    if (this.callCount >= RATE_LIMIT_CALLS_PER_WINDOW) {
      const timeUntilReset = RATE_LIMIT_WINDOW_RESET_MS - timeSinceWindowStart;
      if (timeUntilReset > 0) {
        console.log(`[GEMI Rate Limiter] Reached ${RATE_LIMIT_CALLS_PER_WINDOW} calls, waiting ${timeUntilReset}ms for window reset...`);
        this.pendingRequest = new Promise((resolve) => setTimeout(resolve, timeUntilReset));
        await this.pendingRequest;
        // Reset after waiting
        this.callCount = 0;
        this.windowStartTime = Date.now();
        this.lastRequestTime = Date.now();
        this.pendingRequest = null;
        return;
      }
    }

    // Normal delay between requests (7.5 seconds)
    const timeSinceLastRequest = now - this.lastRequestTime;
    const delayNeeded = Math.max(0, RATE_LIMIT_DELAY_MS - timeSinceLastRequest);

    if (delayNeeded > 0) {
      this.pendingRequest = new Promise((resolve) => setTimeout(resolve, delayNeeded));
      await this.pendingRequest;
    }

    this.lastRequestTime = Date.now();
    this.callCount++;
    this.pendingRequest = null;
    
    console.log(`[GEMI Rate Limiter] Call ${this.callCount}/${RATE_LIMIT_CALLS_PER_WINDOW} in current window`);
  }

  // Reset rate limiter window (useful after 429 errors)
  reset(): void {
    this.callCount = 0;
    this.windowStartTime = Date.now();
    this.lastRequestTime = Date.now();
    console.log(`[GEMI Rate Limiter] Window reset manually`);
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

// Add API key to requests - GEMI API expects it as a header
gemiClient.interceptors.request.use((config) => {
  if (!GEMI_API_KEY || GEMI_API_KEY.trim() === '') {
    console.error('[GEMI] ⚠️  ERROR: GEMI_API_KEY is not set or is empty!');
    throw new Error('GEMI_API_KEY is not configured. Please set the GEMI_API_KEY environment variable.');
  }
  
  // GEMI API expects API key in X-API-Key header
  config.headers = config.headers || {};
  config.headers['X-API-Key'] = GEMI_API_KEY;
  
  // Also try as query parameter (some APIs accept both)
  config.params = config.params || {};
  config.params.api_key = GEMI_API_KEY;
  
  console.log(`[GEMI] API key added to request headers (key length: ${GEMI_API_KEY.length}, first 4 chars: ${GEMI_API_KEY.substring(0, 4)}...)`);
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
 * Fetch companies from GEMI API for a specific municipality, multiple municipalities, or prefecture
 * Automatically handles pagination
 * @param municipalityGemiId - Municipality GEMI ID or array of IDs (optional if prefectureGemiId is provided)
 * @param activityId - Activity/Industry GEMI ID or array of IDs (optional)
 * @param prefectureGemiId - Prefecture GEMI ID (optional if municipalityGemiId is provided)
 */
export async function fetchGemiCompaniesForMunicipality(
  municipalityGemiId?: number | number[],
  activityId?: number | number[],
  prefectureGemiId?: number,
  startOffset?: number
): Promise<{ companies: GemiCompany[]; nextOffset: number; hasMore: boolean }> {
  if (!GEMI_API_KEY) {
    throw new Error('GEMI_API_KEY is not configured');
  }

  if (!municipalityGemiId && !prefectureGemiId) {
    throw new Error('Either municipalityGemiId or prefectureGemiId must be provided');
  }

  const allCompanies: GemiCompany[] = [];
  let resultsOffset = startOffset || 0;
  const resultsSize = 200; // Maximum results per request as per API documentation
  let totalCount = 0;
  let hasMore = true;
  const SAFETY_LIMIT = 10000; // Safety limit per call

  // Normalize municipalityGemiId to array for consistent handling
  const municipalityIds = municipalityGemiId 
    ? (Array.isArray(municipalityGemiId) ? municipalityGemiId : [municipalityGemiId])
    : [];

  const locationType = municipalityGemiId 
    ? (municipalityIds.length > 1 ? `${municipalityIds.length} municipalities` : 'municipality')
    : 'prefecture';
  const locationId = municipalityGemiId 
    ? (municipalityIds.length > 1 ? municipalityIds.join(',') : String(municipalityIds[0]))
    : String(prefectureGemiId);
  const initialActivityDesc = activityId 
    ? (Array.isArray(activityId) 
        ? `${activityId.length} activities: [${activityId.join(', ')}]`
        : `activity ${activityId}`)
    : 'all activities';
  console.log(`[GEMI] Fetching companies for ${locationType} ${locationId} with ${initialActivityDesc}...`);

  while (hasMore) {
    // Acquire rate limiter lock
    await rateLimiter.acquire();

    try {
      const params: any = {
        resultsOffset,
        resultsSize, // Maximum 200 results per request
        resultsSortBy: '+arGemi', // Sort by AR GEMI ascending
        isActive: true, // Always fetch only active businesses
      };

      // Use municipality if provided, otherwise use prefecture
      if (municipalityGemiId) {
        // GEMI API may need comma-separated string for multiple municipalities
        // Try sending as comma-separated string if multiple, single number if one
        if (municipalityIds.length === 1) {
          params.municipalities = municipalityIds[0];
        } else {
          // Send as comma-separated string: "123,456,789"
          params.municipalities = municipalityIds.join(',');
        }
      } else if (prefectureGemiId) {
        params.prefectures = prefectureGemiId; // Use 'prefectures' (plural) for prefecture-level queries
      }

      if (activityId) {
        // Normalize activityId to array for consistent handling
        const activityIds = Array.isArray(activityId) ? activityId : [activityId];
        // GEMI API may need comma-separated string for multiple activities
        if (activityIds.length === 1) {
          params.activities = activityIds[0];
        } else {
          // Send as comma-separated string: "123,456,789"
          params.activities = activityIds.join(',');
        }
      }

      console.log(`[GEMI] Fetching page at offset ${resultsOffset} with size ${resultsSize}...`);
      console.log(`[GEMI] Request parameters:`, JSON.stringify(params, null, 2));
      console.log(`[GEMI] Request URL: ${GEMI_API_BASE_URL}/companies`);
      console.log(`[GEMI] Expected next offset after this request: ${resultsOffset + resultsSize}`);

      // Retry logic for 429 rate limit errors with exponential backoff
      let response: any;
      let retryCount = 0;
      const maxRetries = 5;
      const baseRetryDelay = 60000; // Start with 60 seconds for 429 errors
      
      while (retryCount <= maxRetries) {
        try {
          response = await gemiClient.get<any>('/companies', { params });
          break; // Success, exit retry loop
        } catch (error: any) {
          if (error.response?.status === 429 && retryCount < maxRetries) {
            // Rate limit exceeded - wait with exponential backoff
            const retryDelay = baseRetryDelay * Math.pow(2, retryCount); // 60s, 120s, 240s, 480s, 960s
            retryCount++;
            console.warn(`[GEMI] Rate limit exceeded (429), retry ${retryCount}/${maxRetries} after ${retryDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            // Reset rate limiter window after 429 error
            rateLimiter.reset();
            continue;
          } else {
            // Re-throw if not a 429 error or max retries reached
            throw error;
          }
        }
      }
      
      console.log(`[GEMI] Response status: ${response.status}`);

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
        console.log(`[GEMI] Response data keys:`, response.data ? Object.keys(response.data) : 'null');
        console.log(`[GEMI] Full response (first 1000 chars):`, JSON.stringify(response.data).substring(0, 1000));
        
        // Check if we've reached the total count - if so, we're done
        // If totalCount is known and we've reached/passed it, stop
        if (totalCount > 0 && resultsOffset >= totalCount) {
          console.log(`[GEMI] Reached total count (${totalCount}) at offset ${resultsOffset}, stopping pagination`);
          hasMore = false;
          break;
        }
        
        // If we don't know totalCount yet, or we haven't reached it, this might be an API limit
        // Try to continue, but log a warning
        if (totalCount > 0 && resultsOffset < totalCount) {
          console.warn(`[GEMI] ⚠️  Empty results at offset ${resultsOffset} but totalCount (${totalCount}) suggests more results exist. This may be an API limit.`);
        }
        
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
        // If both have values, prefer coNameEl (Greek)
        // Handle arrays - take first element if it's an array
        let businessName = 'Unknown';
        
        // Extract values from arrays or strings
        const coNamesEnValue = c.coNamesEn 
          ? (Array.isArray(c.coNamesEn) ? c.coNamesEn[0] : c.coNamesEn)
          : null;
        const coNameElValue = c.coNameEl || c.coNamesEL
          ? (Array.isArray(c.coNameEl || c.coNamesEL) ? (c.coNameEl || c.coNamesEL)[0] : (c.coNameEl || c.coNamesEL))
          : null;
        
        // If both have values, prefer Greek (coNameEl)
        if (coNameElValue && coNamesEnValue) {
          businessName = coNameElValue;
        } else if (coNameElValue) {
          businessName = coNameElValue;
        } else if (coNamesEnValue) {
          businessName = coNamesEnValue;
        } else if (c.name) {
          businessName = Array.isArray(c.name) ? (c.name[0] || 'Unknown') : c.name;
        } else if (c.companyName) {
          businessName = Array.isArray(c.companyName) ? (c.companyName[0] || 'Unknown') : c.companyName;
        } else if (c.legalName) {
          businessName = Array.isArray(c.legalName) ? (c.legalName[0] || 'Unknown') : c.legalName;
        }

        // Map url field to website_url
        const websiteUrl = c.url || c.websiteUrl || c.website_url || c.website || null;

        return {
          ar_gemi: c.arGemi || c.ar_gemi || c.ar || String(c.arGemi || c.ar_gemi || c.ar || ''),
          name: businessName,
          legal_name: c.legalName || c.legal_name || businessName,
          municipality_id: municipalityId,
          prefecture_id: prefectureId,
          address: c.address || c.fullAddress || null,
          postal_code: c.postalCode || c.postal_code || c.zipCode || null,
          website_url: websiteUrl,
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
      // Increment offset by resultsSize (200) to get the next page, not by the number of results received
      // This ensures proper pagination even if some results are filtered out
      const previousOffset = resultsOffset;
      resultsOffset += resultsSize;
      console.log(`[GEMI] Pagination: offset ${previousOffset} → ${resultsOffset} (incremented by ${resultsSize})`);
      
      // Continue if:
      // 1. We got results in this batch (might be less than resultsSize if near the end)
      // 2. AND (we don't know totalCount yet OR we haven't reached the total)
      hasMore = validCompanies.length > 0 && (totalCount === 0 || resultsOffset < totalCount);

      console.log(`[GEMI] Fetched ${validCompanies.length} companies (total: ${allCompanies.length}/${totalCount || 'unknown'}), next offset will be: ${resultsOffset}`);
      
      if (!hasMore) {
        console.log(`[GEMI] No more results: validCompanies=${validCompanies.length}, totalCount=${totalCount || 'unknown'}, currentOffset=${resultsOffset}`);
      }

      // Safety check: if we reach 10,000 results in this call, stop and return
      // The caller can continue by calling again with startOffset
      if (resultsOffset >= SAFETY_LIMIT) {
        console.warn(`[GEMI] Reached safety limit of ${SAFETY_LIMIT} results at offset ${resultsOffset}`);
        console.warn(`[GEMI] Returning ${allCompanies.length} companies. To continue, call again with startOffset=${resultsOffset}`);
        hasMore = false;
        break;
      }
    } catch (error: any) {
      // Handle 404 as "no businesses found" rather than an error
      if (error.response && error.response.status === 404) {
        const locationDesc = municipalityGemiId 
          ? (municipalityIds.length > 1 
              ? `${municipalityIds.length} municipalities` 
              : `municipality ${municipalityIds[0]}`)
          : `prefecture ${prefectureGemiId}`;
        const activityDesc = activityId 
          ? (Array.isArray(activityId) 
              ? ` and ${activityId.length} activities: [${activityId.join(', ')}]`
              : ` and activity ${activityId}`)
          : '';
        console.log(`[GEMI] No businesses found for ${locationDesc}${activityDesc} (404)`);
        console.log(`[GEMI] 404 Response status: ${error.response.status}`);
        console.log(`[GEMI] 404 Response headers:`, JSON.stringify(error.response.headers, null, 2));
        console.log(`[GEMI] 404 Response data:`, JSON.stringify(error.response.data, null, 2));
        console.log(`[GEMI] 404 Request URL: ${error.config?.url || 'unknown'}`);
        console.log(`[GEMI] 404 Request params:`, JSON.stringify(error.config?.params || {}, null, 2));
        // Return empty array - this is a valid response meaning no businesses match the criteria
        hasMore = false;
        break;
      }
      
      // For other errors, log and throw
      console.error(`[GEMI] Error fetching companies at offset ${resultsOffset}:`, error.message);
      if (error.response) {
        console.error(`[GEMI] Status: ${error.response.status}, Data:`, error.response.data);
      }
      throw error;
    }
  }

  const locationDesc = municipalityGemiId 
    ? (municipalityIds.length > 1 
        ? `${municipalityIds.length} municipalities` 
        : `municipality ${municipalityIds[0]}`)
    : `prefecture ${prefectureGemiId}`;
  const finalActivityDesc = activityId 
    ? (Array.isArray(activityId) 
        ? ` and ${activityId.length} activities: [${activityId.join(', ')}]`
        : ` and activity ${activityId}`)
    : '';
  console.log(`[GEMI] ✅ Fetched ${allCompanies.length} companies for ${locationDesc}${finalActivityDesc} (offset: ${resultsOffset})`);

  return {
    companies: allCompanies,
    nextOffset: resultsOffset,
    hasMore: hasMore && resultsOffset < SAFETY_LIMIT
  };
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
    console.warn(`[GEMI] This could mean:`);
    console.warn(`[GEMI]   1. The GEMI API returned no results for the given criteria`);
    console.warn(`[GEMI]   2. The API response structure was unexpected`);
    console.warn(`[GEMI]   3. All companies were filtered out (missing ar_gemi)`);
    console.warn(`[GEMI] Check the logs above for the API request parameters and response structure.`);
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  
  // OPTIMIZATION: Batch lookups for municipalities and existing businesses
  // This reduces queries from 3 per business to 3 total (for all businesses)
  
  // Step 1: Batch lookup all unique municipalities
  const uniqueMunicipalityGemiIds = [...new Set(
    companies
      .filter(c => c.municipality_id)
      .map(c => String(c.municipality_id))
  )];
  
  const municipalityMap = new Map<string, { id: string; prefecture_id: string }>();
  if (uniqueMunicipalityGemiIds.length > 0) {
    console.log(`[GEMI] Batch looking up ${uniqueMunicipalityGemiIds.length} unique municipalities...`);
    const municipalityResults = await pool.query<{ id: string; prefecture_id: string; gemi_id: string }>(
      'SELECT id, prefecture_id, gemi_id FROM municipalities WHERE gemi_id = ANY($1)',
      [uniqueMunicipalityGemiIds]
    );
    for (const row of municipalityResults.rows) {
      municipalityMap.set(row.gemi_id, { id: row.id, prefecture_id: row.prefecture_id });
    }
    console.log(`[GEMI] Found ${municipalityMap.size} municipalities`);
  }
  
  // Step 2: Batch lookup all existing businesses by ar_gemi
  const arGemiList = companies.filter(c => c.ar_gemi).map(c => c.ar_gemi!);
  console.log(`[GEMI] Batch checking ${arGemiList.length} businesses for existing records...`);
  const existingBusinessesResult = await pool.query<{ id: string; ar_gemi: string }>(
    'SELECT id, ar_gemi FROM businesses WHERE ar_gemi = ANY($1)',
    [arGemiList]
  );
  const existingBusinessMap = new Map<string, string>();
  for (const row of existingBusinessesResult.rows) {
    existingBusinessMap.set(row.ar_gemi, row.id);
  }
  console.log(`[GEMI] Found ${existingBusinessMap.size} existing businesses, ${arGemiList.length - existingBusinessMap.size} will be inserted`);
  
  // Step 3: Prepare all businesses for batch insert/update
  const businessesToInsert: any[] = [];
  const businessesToUpdate: any[] = [];
  
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    
    try {
      // Validate required field
      if (!company.ar_gemi) {
        console.warn(`[GEMI] [${i + 1}/${companies.length}] ⚠️  Skipping company without ar_gemi`);
        skipped++;
        continue;
      }
      
      if ((i + 1) % 1000 === 0 || i === 0) {
        console.log(`[GEMI] [${i + 1}/${companies.length}] Processing: ${company.ar_gemi} - ${company.name || company.legal_name || 'Unknown'}`);
      }

      // Get municipality_id and prefecture_id from batch lookup
      let municipalityId: string | null = null;
      let prefectureId: string | null = null;
      
      if (company.municipality_id) {
        const municipalityGemiId = String(company.municipality_id);
        const municipalityData = municipalityMap.get(municipalityGemiId);
        if (municipalityData) {
          municipalityId = municipalityData.id;
          prefectureId = municipalityData.prefecture_id;
        }
      }

      // Prepare business data
      const businessData = {
        ar_gemi: company.ar_gemi,
        name: company.name || 'Unknown',
        address: company.address || null,
        postal_code: company.postal_code || null,
        municipality_id: municipalityId,
        prefecture_id: prefectureId,
        website_url: company.website_url || null,
        phone: company.phone || null,
        email: company.email || null,
        dataset_id: datasetId,
        owner_user_id: userId,
        discovery_run_id: discoveryRunId || null,
      };
      
      // Check if business exists (from batch lookup)
      const existingBusinessId = existingBusinessMap.get(company.ar_gemi);
      
      if (existingBusinessId) {
        // Will update
        businessesToUpdate.push({
          id: existingBusinessId,
          ...businessData
        });
      } else {
        // Will insert
        businessesToInsert.push(businessData);
      }
    } catch (error: any) {
      console.error(`[GEMI] ❌ Error preparing company [${i + 1}/${companies.length}] ${company.ar_gemi || 'unknown'}:`, error.message);
      skipped++;
    }
  }
  
  // Step 4: Batch INSERT new businesses
  if (businessesToInsert.length > 0) {
    console.log(`[GEMI] Batch inserting ${businessesToInsert.length} new businesses...`);
    const BATCH_SIZE = 500; // Insert in batches of 500 to avoid query size limits
    
    for (let i = 0; i < businessesToInsert.length; i += BATCH_SIZE) {
      const batch = businessesToInsert.slice(i, i + BATCH_SIZE);
      const values = batch.map((b, idx) => {
        const base = idx * 12;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, NOW(), NOW())`;
      }).join(', ');
      
      const params = batch.flatMap(b => [
        b.ar_gemi, b.name, b.address, b.postal_code,
        b.municipality_id, b.prefecture_id,
        b.website_url, b.phone, b.email,
        b.dataset_id, b.owner_user_id, b.discovery_run_id
      ]);
      
      try {
        await pool.query(
          `INSERT INTO businesses (
            ar_gemi, name, address, postal_code,
            municipality_id, prefecture_id,
            website_url, phone, email,
            dataset_id, owner_user_id, discovery_run_id, created_at, updated_at
          ) VALUES ${values}`,
          params
        );
        inserted += batch.length;
        if ((i / BATCH_SIZE + 1) % 10 === 0 || i === 0) {
          console.log(`[GEMI] Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${inserted} total inserted`);
        }
      } catch (error: any) {
        console.error(`[GEMI] Error in batch insert (batch ${Math.floor(i / BATCH_SIZE) + 1}):`, error.message);
        // Fallback to individual inserts for this batch
        for (const b of batch) {
          try {
            await pool.query(
              `INSERT INTO businesses (
                ar_gemi, name, address, postal_code,
                municipality_id, prefecture_id,
                website_url, phone, email,
                dataset_id, owner_user_id, discovery_run_id, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
              [b.ar_gemi, b.name, b.address, b.postal_code, b.municipality_id, b.prefecture_id,
               b.website_url, b.phone, b.email, b.dataset_id, b.owner_user_id, b.discovery_run_id]
            );
            inserted++;
          } catch (individualError: any) {
            console.error(`[GEMI] Failed to insert ${b.ar_gemi}:`, individualError.message);
            skipped++;
          }
        }
      }
    }
  }
  
  // Step 5: Batch UPDATE existing businesses using unnest for performance
  if (businessesToUpdate.length > 0) {
    console.log(`[GEMI] Batch updating ${businessesToUpdate.length} existing businesses...`);
    const BATCH_SIZE = 500; // Update in batches of 500
    
    for (let i = 0; i < businessesToUpdate.length; i += BATCH_SIZE) {
      const batch = businessesToUpdate.slice(i, i + BATCH_SIZE);
      
      try {
        // Use unnest for efficient batch UPDATE
        const ids = batch.map(b => b.id);
        const names = batch.map(b => b.name);
        const addresses = batch.map(b => b.address);
        const postalCodes = batch.map(b => b.postal_code);
        const municipalityIds = batch.map(b => b.municipality_id);
        const prefectureIds = batch.map(b => b.prefecture_id);
        const websiteUrls = batch.map(b => b.website_url);
        const phones = batch.map(b => b.phone);
        const emails = batch.map(b => b.email);
        const datasetIds = batch.map(b => b.dataset_id);
        const discoveryRunIds = batch.map(b => b.discovery_run_id);
        
        const result = await pool.query(
          `UPDATE businesses b SET
            name = u.name,
            address = COALESCE(u.address, b.address),
            postal_code = COALESCE(u.postal_code, b.postal_code),
            municipality_id = COALESCE(u.municipality_id, b.municipality_id),
            prefecture_id = COALESCE(u.prefecture_id, b.prefecture_id),
            website_url = COALESCE(u.website_url, b.website_url),
            phone = COALESCE(u.phone, b.phone),
            email = COALESCE(u.email, b.email),
            dataset_id = u.dataset_id,
            discovery_run_id = COALESCE(u.discovery_run_id, b.discovery_run_id),
            updated_at = NOW()
          FROM (
            SELECT 
              unnest($1::uuid[]) as id,
              unnest($2::text[]) as name,
              unnest($3::text[]) as address,
              unnest($4::text[]) as postal_code,
              unnest($5::uuid[]) as municipality_id,
              unnest($6::uuid[]) as prefecture_id,
              unnest($7::text[]) as website_url,
              unnest($8::text[]) as phone,
              unnest($9::text[]) as email,
              unnest($10::uuid[]) as dataset_id,
              unnest($11::uuid[]) as discovery_run_id
          ) u
          WHERE b.id = u.id`,
          [
            ids, names, addresses, postalCodes, municipalityIds, prefectureIds,
            websiteUrls, phones, emails, datasetIds, discoveryRunIds
          ]
        );
        
        updated += result.rowCount || batch.length;
        if ((i / BATCH_SIZE + 1) % 10 === 0 || i === 0) {
          console.log(`[GEMI] Updated batch ${Math.floor(i / BATCH_SIZE) + 1}: ${updated} total updated`);
        }
      } catch (error: any) {
        console.error(`[GEMI] Error in batch update (batch ${Math.floor(i / BATCH_SIZE) + 1}):`, error.message);
        // Fallback to individual updates for this batch
        for (const b of batch) {
          try {
            await pool.query(
              `UPDATE businesses SET
                name = $1,
                address = COALESCE($2, address),
                postal_code = COALESCE($3, postal_code),
                municipality_id = COALESCE($4, municipality_id),
                prefecture_id = COALESCE($5, prefecture_id),
                website_url = COALESCE($6, website_url),
                phone = COALESCE($7, phone),
                email = COALESCE($8, email),
                dataset_id = $9,
                discovery_run_id = COALESCE($10, discovery_run_id),
                updated_at = NOW()
              WHERE id = $11`,
              [b.name, b.address, b.postal_code, b.municipality_id, b.prefecture_id,
               b.website_url, b.phone, b.email, b.dataset_id, b.discovery_run_id, b.id]
            );
            updated++;
          } catch (individualError: any) {
            console.error(`[GEMI] Failed to update ${b.ar_gemi}:`, individualError.message);
            skipped++;
          }
        }
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
