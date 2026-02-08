/**
 * Vrisko Discovery Worker
 * 
 * Integrates with existing PostgreSQL schema:
 * - discovery_runs
 * - businesses
 * - contacts
 * - contact_sources
 * - extraction_jobs
 * - websites
 * 
 * NO new tables created.
 * Uses existing relationships exactly.
 */

import { pool } from '../config/database.js';
import { getDatasetById } from '../db/datasets.js';
import { getCityById, getCities } from '../db/cities.js';
import { getIndustryById, getIndustries } from '../db/industries.js';
import { createDiscoveryRun, updateDiscoveryRun, type DiscoveryRun } from '../db/discoveryRuns.js';
import { upsertBusinessGlobal } from '../db/businessesShared.js';
import { getOrCreateContact } from '../db/contacts.js';
import { createContactSource } from '../db/contactSources.js';
import { getOrCreateWebsite } from '../db/websites.js';
import { createExtractionJob } from '../db/extractionJobs.js';
import { VriskoCrawler } from '../crawler/vrisko/vriskoCrawler.js';
import type { VriskoBusiness } from '../crawler/vrisko/vriskoParser.js';
import { normalizeBusinessName } from '../utils/normalizeBusinessName.js';
import { Logger } from '../crawler/vrisko/utils/logger.js';
import { enforceDiscoveryRun } from '../services/enforcementService.js';
import { consumeCredits } from '../services/creditService.js';
import { calculateDiscoveryCost } from '../config/creditCostConfig.js';
import { incrementCrawls } from '../db/usageTracking.js';

const logger = new Logger('VriskoWorker');

export interface VriskoDiscoveryResult {
  discoveryRunId: string;
  citiesProcessed: number;
  industriesProcessed: number;
  searchesExecuted: number;
  businessesFound: number;
  businessesCreated: number;
  businessesUpdated: number;
  contactsCreated: number;
  extractionJobsCreated: number;
  errors: string[];
}

/**
 * Run Vrisko discovery for a dataset
 */
export async function runVriskoDiscovery(datasetId: string): Promise<VriskoDiscoveryResult> {
  const result: VriskoDiscoveryResult = {
    discoveryRunId: '',
    citiesProcessed: 0,
    industriesProcessed: 0,
    searchesExecuted: 0,
    businessesFound: 0,
    businessesCreated: 0,
    businessesUpdated: 0,
    contactsCreated: 0,
    extractionJobsCreated: 0,
    errors: [],
  };

  let discoveryRun: DiscoveryRun | null = null;

  try {
    // STEP 1: Get dataset
    const dataset = await getDatasetById(datasetId);
    if (!dataset) {
      throw new Error(`Dataset ${datasetId} not found`);
    }

    logger.info(`Starting Vrisko discovery for dataset ${datasetId} (user: ${dataset.user_id})`);

    // STEP 2: Create discovery run
    discoveryRun = await createDiscoveryRun(datasetId, dataset.user_id);
    await updateDiscoveryRun(discoveryRun.id, {
      started_at: new Date(),
    });
    result.discoveryRunId = discoveryRun.id;

    logger.info(`Created discovery run ${discoveryRun.id}`);

    // STEP 2.5: Enforce limits and estimate credit cost
    // Estimate businesses (rough estimate: 20 per keyword per city-industry combination)
    const estimatedBusinesses = cities.length * industries.length * 20;
    await enforceDiscoveryRun(dataset.user_id, estimatedBusinesses);
    logger.info(`Enforcement passed: estimated ${estimatedBusinesses} businesses`);

    // STEP 3: Load targets (cities and industries)
    const citiesQuery = dataset.city_id
      ? pool.query<{ id: string; name: string; vrisko_search?: string; is_active?: boolean }>(
          'SELECT id, name, vrisko_search, is_active FROM cities WHERE id = $1 AND (is_active = TRUE OR is_active IS NULL)',
          [dataset.city_id]
        )
      : pool.query<{ id: string; name: string; vrisko_search?: string; is_active?: boolean }>(
          'SELECT id, name, vrisko_search, is_active FROM cities WHERE is_active = TRUE OR is_active IS NULL ORDER BY name'
        );

    const industriesQuery = dataset.industry_id
      ? pool.query<{ id: string; name: string; vrisko_keyword?: string; discovery_keywords?: any; crawl_priority?: number; is_active?: boolean }>(
          'SELECT id, name, vrisko_keyword, discovery_keywords, crawl_priority, is_active FROM industries WHERE id = $1 AND (is_active = TRUE OR is_active IS NULL)',
          [dataset.industry_id]
        )
      : pool.query<{ id: string; name: string; vrisko_keyword?: string; discovery_keywords?: any; crawl_priority?: number; is_active?: boolean }>(
          'SELECT id, name, vrisko_keyword, discovery_keywords, crawl_priority, is_active FROM industries WHERE is_active = TRUE OR is_active IS NULL ORDER BY crawl_priority DESC NULLS LAST, name'
        );

    const [citiesResult, industriesResult] = await Promise.all([citiesQuery, industriesQuery]);
    const cities = citiesResult.rows;
    const industries = industriesResult.rows;

    logger.info(`Loaded ${cities.length} cities and ${industries.length} industries`);

    if (cities.length === 0) {
      throw new Error('No active cities found');
    }
    if (industries.length === 0) {
      throw new Error('No active industries found');
    }

    // STEP 4: Process each city-industry combination
    const crawler = new VriskoCrawler({
      maxPages: 50,
      concurrency: 1,
      delayBetweenPages: true,
    });

    for (const city of cities) {
      for (const industry of industries) {
        try {
          logger.info(`Processing: ${industry.name} in ${city.name}`);

          // STEP 5: Generate search keywords
          const searchKeywords: string[] = [];
          
          // Primary keyword
          const primaryKeyword = industry.vrisko_keyword || industry.name;
          if (primaryKeyword) {
            searchKeywords.push(primaryKeyword);
          }

          // Secondary keywords from discovery_keywords
          if (industry.discovery_keywords) {
            let keywords: string[] = [];
            if (Array.isArray(industry.discovery_keywords)) {
              keywords = industry.discovery_keywords;
            } else if (typeof industry.discovery_keywords === 'string') {
              try {
                const parsed = JSON.parse(industry.discovery_keywords);
                keywords = Array.isArray(parsed) ? parsed : [industry.discovery_keywords];
              } catch {
                keywords = [industry.discovery_keywords];
              }
            }

            for (const keyword of keywords) {
              if (keyword && !searchKeywords.includes(keyword)) {
                searchKeywords.push(keyword);
              }
            }
          }

          if (searchKeywords.length === 0) {
            logger.warn(`No keywords for ${industry.name}, skipping`);
            continue;
          }

          // Location string
          const locationString = city.vrisko_search || city.name;

          // STEP 6: Crawl Vrisko for each keyword
          const seenBusinesses = new Map<string, VriskoBusiness>();

          for (const keyword of searchKeywords) {
            try {
              logger.info(`Searching: "${keyword}" in "${locationString}"`);
              
              const vriskoResults = await crawler.crawl(keyword, locationString, 50);
              result.searchesExecuted++;

              // Deduplicate by name + city
              for (const business of vriskoResults) {
                const key = `${business.name.toLowerCase().trim()}_${business.address.city}`;
                if (!seenBusinesses.has(key)) {
                  seenBusinesses.set(key, business);
                }
              }

              logger.info(`Found ${vriskoResults.length} businesses (${seenBusinesses.size} unique so far)`);
            } catch (error: any) {
              const errorMsg = `Failed to search "${keyword}" in "${locationString}": ${error.message}`;
              logger.error(errorMsg, error);
              result.errors.push(errorMsg);
            }
          }

          // Enforce dataset size before processing businesses
          if (seenBusinesses.size > 0) {
            try {
              await enforceDatasetSize(dataset.user_id, dataset.id, seenBusinesses.size);
            } catch (error: any) {
              if (error.code === 'DATASET_SIZE_LIMIT_REACHED') {
                logger.warn(`Dataset size limit reached, skipping ${seenBusinesses.size} businesses`);
                result.errors.push(`Dataset size limit reached: ${error.message}`);
                continue; // Skip this city-industry combination
              }
              throw error;
            }
          }

          // STEP 7: Process businesses
          for (const vriskoBusiness of seenBusinesses.values()) {
            try {
              await processVriskoBusiness(
                vriskoBusiness,
                city.id,
                industry.id,
                dataset,
                discoveryRun.id,
                result
              );
            } catch (error: any) {
              const errorMsg = `Failed to process business "${vriskoBusiness.name}": ${error.message}`;
              logger.error(errorMsg, error);
              result.errors.push(errorMsg);
            }
          }

          result.citiesProcessed++;
          result.industriesProcessed++;

        } catch (error: any) {
          const errorMsg = `Failed to process ${industry.name} in ${city.name}: ${error.message}`;
          logger.error(errorMsg, error);
          result.errors.push(errorMsg);
        }
      }
    }

    // STEP 9: Consume credits based on businesses found
    const creditCost = calculateDiscoveryCost(result.businessesFound);
    if (creditCost > 0) {
      try {
        await consumeCredits(
          dataset.user_id,
          creditCost,
          `Discovery run: ${result.businessesFound} businesses found`,
          discoveryRun.id
        );
        logger.info(`Consumed ${creditCost} credits for discovery run`);
      } catch (error: any) {
        logger.error(`Failed to consume credits: ${error.message}`);
        result.errors.push(`Credit consumption failed: ${error.message}`);
      }
    }

    // Increment crawl usage
    try {
      await incrementCrawls(dataset.user_id);
    } catch (error: any) {
      logger.warn(`Failed to increment crawl usage: ${error.message}`);
    }

    // STEP 10: Mark discovery run as completed
    await updateDiscoveryRun(discoveryRun.id, {
      status: 'completed',
      completed_at: new Date(),
    });

    logger.success(`Discovery completed: ${result.businessesCreated} created, ${result.businessesUpdated} updated`);

  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Discovery failed: ${errorMsg}`, error);
    result.errors.push(`Discovery error: ${errorMsg}`);

    // Mark discovery run as failed
    if (discoveryRun) {
      await updateDiscoveryRun(discoveryRun.id, {
        status: 'failed',
        completed_at: new Date(),
        error_message: errorMsg,
      });
    }
  }

  return result;
}

/**
 * Process a single Vrisko business listing
 */
async function processVriskoBusiness(
  vriskoBusiness: VriskoBusiness,
  cityId: string,
  industryId: string,
  dataset: { id: string; user_id: string },
  discoveryRunId: string,
  result: VriskoDiscoveryResult
): Promise<void> {
  // Generate unique identifier for business
  const uniqueId = `${vriskoBusiness.name}_${vriskoBusiness.address.street}_${vriskoBusiness.address.city}_${vriskoBusiness.address.postal_code}`;
  const googlePlaceId = `vrisko_${Buffer.from(uniqueId).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 50)}`;

  // STEP 6: Upsert business
  const address = `${vriskoBusiness.address.street}, ${vriskoBusiness.address.city} ${vriskoBusiness.address.postal_code}`.trim();
  
  const { business, wasNew, wasUpdated } = await upsertBusinessGlobal({
    name: vriskoBusiness.name,
    normalized_name: normalizeBusinessName(vriskoBusiness.name),
    address: address || null,
    postal_code: vriskoBusiness.address.postal_code || null,
    city_id: cityId,
    industry_id: industryId,
    dataset_id: dataset.id,
    google_place_id: googlePlaceId,
    owner_user_id: dataset.user_id,
    discovery_run_id: discoveryRunId,
    latitude: vriskoBusiness.location.latitude || null,
    longitude: vriskoBusiness.location.longitude || null,
  });

  if (wasNew) {
    result.businessesCreated++;
  } else if (wasUpdated) {
    result.businessesUpdated++;
  }
  result.businessesFound++;

  // Update business website if available
  if (vriskoBusiness.website) {
    try {
      await getOrCreateWebsite(business.id, vriskoBusiness.website);
    } catch (error: any) {
      logger.warn(`Failed to create website for business ${business.id}: ${error.message}`);
    }
  }

  // Update business phone and emails if table has these fields
  // Note: We also create contacts below for consistency
  if (vriskoBusiness.phones.length > 0 || vriskoBusiness.email) {
    try {
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (vriskoBusiness.phones.length > 0) {
        updates.push(`phone = $${paramIndex++}`);
        values.push(vriskoBusiness.phones[0]);
      }

      if (vriskoBusiness.email) {
        updates.push(`emails = $${paramIndex++}`);
        values.push(JSON.stringify([vriskoBusiness.email]));
      }

      if (updates.length > 0) {
        values.push(business.id);
        await pool.query(
          `UPDATE businesses SET ${updates.join(', ')}, last_discovered_at = NOW(), crawl_status = 'pending' WHERE id = $${paramIndex}`,
          values
        );
      } else {
        // Update last_discovered_at and crawl_status even if no phone/email
        await pool.query(
          `UPDATE businesses SET last_discovered_at = NOW(), crawl_status = 'pending' WHERE id = $1`,
          [business.id]
        );
      }
    } catch (error: any) {
      // Ignore if columns don't exist - we'll use contacts instead
      logger.debug(`Could not update business phone/email directly: ${error.message}`);
    }
  }

  // STEP 7: Create contacts
  // Phone contacts
  for (const phone of vriskoBusiness.phones) {
    try {
      const phoneContact = await getOrCreateContact({
        phone,
        contact_type: 'phone',
        is_generic: false,
      });

      await createContactSource({
        contact_id: phoneContact.id,
        business_id: business.id.toString(),
        source_url: vriskoBusiness.listing_url,
        page_type: 'homepage', // Using 'homepage' as vrisko listing is the source page
        html_hash: '',
      });

      result.contactsCreated++;
    } catch (error: any) {
      logger.warn(`Failed to create phone contact: ${error.message}`);
    }
  }

  // Email contact
  if (vriskoBusiness.email) {
    try {
      const emailContact = await getOrCreateContact({
        email: vriskoBusiness.email,
        contact_type: 'email',
        is_generic: false,
      });

      await createContactSource({
        contact_id: emailContact.id,
        business_id: business.id.toString(),
        source_url: vriskoBusiness.listing_url,
        page_type: 'homepage', // Using 'homepage' as vrisko listing is the source page
        html_hash: '',
      });

      result.contactsCreated++;
    } catch (error: any) {
      logger.warn(`Failed to create email contact: ${error.message}`);
    }
  }

  // STEP 8: Create extraction job if website exists
  if (vriskoBusiness.website) {
    try {
      await createExtractionJob(business.id);
      result.extractionJobsCreated++;
    } catch (error: any) {
      logger.warn(`Failed to create extraction job for business ${business.id}: ${error.message}`);
    }
  }
}
