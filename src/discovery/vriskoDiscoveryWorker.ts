/**
 * Vrisko.gr Discovery Worker
 * 
 * This is the ONLY discovery source - no Google Maps/Places API
 * 
 * Discovers businesses by:
 * 1. Fetching active cities and industries from database
 * 2. Crawling vrisko.gr search pages
 * 3. Extracting business listings
 * 4. Storing results in businesses table
 */

import { pool } from '../config/database.js';
import { getCities } from '../db/cities.js';
import { getIndustries } from '../db/industries.js';
import { getIndustryById } from '../db/industries.js';
import { getCityById } from '../db/cities.js';
import { VriskoCrawler } from '../crawler/vrisko/vriskoCrawler.js';
import { upsertBusinessGlobal, linkBusinessToDataset } from '../db/businessesShared.js';
import { createDiscoveryRun, updateDiscoveryRun, type DiscoveryRun } from '../db/discoveryRuns.js';
import { getDatasetById } from '../db/datasets.js';
import { normalizeBusinessName } from '../utils/normalizeBusinessName.js';
import { getOrCreateWebsite } from '../db/websites.js';
import { getOrCreateContact } from '../db/contacts.js';
import { createContactSource } from '../db/contactSources.js';
import type { VriskoBusiness } from '../crawler/vrisko/vriskoParser.js';
import { Logger } from '../crawler/vrisko/utils/logger.js';

const logger = new Logger('VriskoDiscoveryWorker');

export interface VriskoDiscoveryResult {
  businessesFound: number;
  businessesCreated: number;
  businessesUpdated: number;
  businessesSkipped: number;
  errors: string[];
  pagesCrawled: number;
  searchesExecuted: number;
}

/**
 * Discover businesses using vrisko.gr for a specific city and industry
 */
export async function discoverBusinessesVrisko(
  cityId: string,
  industryId: string,
  datasetId: string,
  discoveryRunId?: string
): Promise<VriskoDiscoveryResult> {
  const result: VriskoDiscoveryResult = {
    businessesFound: 0,
    businessesCreated: 0,
    businessesUpdated: 0,
    businessesSkipped: 0,
    errors: [],
    pagesCrawled: 0,
    searchesExecuted: 0,
  };

  try {
    // Get city and industry from database
    const [city, industry] = await Promise.all([
      getCityById(cityId),
      getIndustryById(industryId),
    ]);

    if (!city) {
      throw new Error(`City ${cityId} not found`);
    }
    if (!industry) {
      throw new Error(`Industry ${industryId} not found`);
    }

    // Check if city and industry are active (if field exists)
    // Note: is_active field may not exist in all schemas - check gracefully
    const cityIsActive = (city as any).is_active !== false;
    const industryIsActive = (industry as any).is_active !== false;
    
    if (!cityIsActive) {
      logger.warn(`City ${city.name} is not active, skipping discovery`);
      return result;
    }
    if (!industryIsActive) {
      logger.warn(`Industry ${industry.name} is not active, skipping discovery`);
      return result;
    }

    logger.info(`Starting vrisko.gr discovery for: ${industry.name} in ${city.name}`);

    // Get dataset for owner_user_id
    const dataset = await getDatasetById(datasetId);
    if (!dataset) {
      throw new Error(`Dataset ${datasetId} not found`);
    }

    // Determine search keywords
    // Primary: Use industry name or vrisko_keyword if available
    // Secondary: Use discovery_keywords array
    const searchKeywords: string[] = [];
    
    // Add primary keyword (industry name or vrisko_keyword)
    const primaryKeyword = (industry as any).vrisko_keyword || industry.name;
    if (primaryKeyword) {
      searchKeywords.push(primaryKeyword);
    }

    // Add secondary keywords from discovery_keywords array
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
      
      // Add keywords that aren't already in the list
      for (const keyword of keywords) {
        if (keyword && !searchKeywords.includes(keyword)) {
          searchKeywords.push(keyword);
        }
      }
    }

    if (searchKeywords.length === 0) {
      throw new Error(`No search keywords found for industry ${industry.name}`);
    }

    logger.info(`Search keywords: ${searchKeywords.join(', ')}`);

    // Determine location string for vrisko
    // Use city name or vrisko_search if available
    const locationString = (city as any).vrisko_search || city.name;
    
    logger.info(`Location string: ${locationString}`);

    // Initialize vrisko crawler
    const crawler = new VriskoCrawler({
      maxPages: 50, // Reasonable limit per keyword
      concurrency: 1, // Sequential to avoid blocking
      delayBetweenPages: true,
    });

    // Track all discovered businesses (for deduplication)
    const seenBusinesses = new Map<string, VriskoBusiness>();
    
    // Search for each keyword
    for (const keyword of searchKeywords) {
      try {
        logger.info(`Searching vrisko.gr: "${keyword}" in "${locationString}"`);
        
        const vriskoResults = await crawler.crawl(keyword, locationString, 50);
        result.searchesExecuted++;
        result.pagesCrawled += Math.ceil(vriskoResults.length / 20); // Approximate pages

        logger.info(`Found ${vriskoResults.length} businesses for keyword "${keyword}"`);

        // Deduplicate by business name + location
        for (const business of vriskoResults) {
          const key = `${business.name.toLowerCase().trim()}_${business.address.city}`;
          if (!seenBusinesses.has(key)) {
            seenBusinesses.set(key, business);
          }
        }
      } catch (error: any) {
        const errorMsg = `Failed to search "${keyword}" in "${locationString}": ${error.message}`;
        logger.error(errorMsg, error);
        result.errors.push(errorMsg);
      }
    }

    logger.info(`Total unique businesses found: ${seenBusinesses.size}`);
    result.businessesFound = seenBusinesses.size;

    // Process and store businesses
    for (const vriskoBusiness of seenBusinesses.values()) {
      try {
        // Generate unique identifier for business (required for upsertBusinessGlobal)
        // Since we don't have Google Place ID, use a hash of name + address
        // Format: vrisko_<base64_hash> to ensure uniqueness
        const uniqueId = `${vriskoBusiness.name}_${vriskoBusiness.address.street}_${vriskoBusiness.address.city}_${vriskoBusiness.address.postal_code}`;
        const googlePlaceId = `vrisko_${Buffer.from(uniqueId).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 50)}`;

        // Upsert business
        const { business, wasNew, wasUpdated } = await upsertBusinessGlobal({
          name: vriskoBusiness.name,
          address: `${vriskoBusiness.address.street}, ${vriskoBusiness.address.city} ${vriskoBusiness.address.postal_code}`.trim(),
          postal_code: vriskoBusiness.address.postal_code || null,
          city_id: cityId,
          industry_id: industryId,
          dataset_id: datasetId,
          google_place_id: googlePlaceId,
          owner_user_id: dataset.user_id,
          discovery_run_id: discoveryRunId || null,
          latitude: vriskoBusiness.location.latitude || null,
          longitude: vriskoBusiness.location.longitude || null,
        });

        if (wasNew) {
          result.businessesCreated++;
        } else if (wasUpdated) {
          result.businessesUpdated++;
        } else {
          result.businessesSkipped++;
        }

        // Link business to dataset
        await linkBusinessToDataset(business.id, datasetId, dataset.user_id);

        // Store website if available
        if (vriskoBusiness.website) {
          try {
            await getOrCreateWebsite(business.id, vriskoBusiness.website);
          } catch (error: any) {
            logger.warn(`Failed to create website for business ${business.id}: ${error.message}`);
          }
        }

        // Store phone contacts
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
              page_type: 'homepage',
              html_hash: '',
            });
          } catch (error: any) {
            logger.warn(`Failed to create phone contact for business ${business.id}: ${error.message}`);
          }
        }

        // Store email if available
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
              page_type: 'homepage',
              html_hash: '',
            });
          } catch (error: any) {
            logger.warn(`Failed to create email contact for business ${business.id}: ${error.message}`);
          }
        }

      } catch (error: any) {
        const errorMsg = `Failed to process business "${vriskoBusiness.name}": ${error.message}`;
        logger.error(errorMsg, error);
        result.errors.push(errorMsg);
      }
    }

    logger.success(`Discovery completed: ${result.businessesCreated} created, ${result.businessesUpdated} updated, ${result.businessesSkipped} skipped`);

  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Discovery failed: ${errorMsg}`, error);
    result.errors.push(`Discovery error: ${errorMsg}`);
  }

  return result;
}

/**
 * Discover businesses for all active city-industry combinations
 * This is useful for bulk discovery or scheduled jobs
 */
export async function discoverAllActiveCombinations(
  userId: string,
  datasetId?: string
): Promise<{ totalRuns: number; results: VriskoDiscoveryResult[] }> {
  logger.info('Starting bulk discovery for all active city-industry combinations');

  // Get active cities and industries
  const [cities, industries] = await Promise.all([
    pool.query<{ id: string; name: string; is_active?: boolean }>(
      'SELECT id, name, is_active FROM cities WHERE is_active = TRUE OR is_active IS NULL ORDER BY name'
    ),
    pool.query<{ id: string; name: string; is_active?: boolean; crawl_priority?: number }>(
      'SELECT id, name, is_active, crawl_priority FROM industries WHERE is_active = TRUE OR is_active IS NULL ORDER BY crawl_priority DESC NULLS LAST, name'
    ),
  ]);

  const activeCities = cities.rows.filter(c => c.is_active !== false);
  const activeIndustries = industries.rows.filter(i => i.is_active !== false);

  logger.info(`Found ${activeCities.length} active cities and ${activeIndustries.length} active industries`);

  const results: VriskoDiscoveryResult[] = [];
  let totalRuns = 0;

  // Process each combination
  for (const city of activeCities) {
    for (const industry of activeIndustries) {
      try {
        // Resolve or create dataset for this combination
        let finalDatasetId = datasetId;
        if (!finalDatasetId) {
          const { resolveDataset } = await import('../services/datasetResolver.js');
          const resolverResult = await resolveDataset({
            userId,
            cityId: city.id,
            industryId: industry.id,
          });
          finalDatasetId = resolverResult.dataset.id;
        }

        // Create discovery run
        const discoveryRun = await createDiscoveryRun(finalDatasetId, userId);
        await updateDiscoveryRun(discoveryRun.id, { started_at: new Date() });

        // Run discovery
        const discoveryResult = await discoverBusinessesVrisko(
          city.id,
          industry.id,
          finalDatasetId,
          discoveryRun.id
        );

        // Update discovery run
        await updateDiscoveryRun(discoveryRun.id, {
          status: discoveryResult.errors.length > 0 ? 'failed' : 'completed',
          completed_at: new Date(),
        });

        results.push(discoveryResult);
        totalRuns++;

        logger.info(`Completed discovery for ${industry.name} in ${city.name}: ${discoveryResult.businessesCreated} created`);

      } catch (error: any) {
        const errorMsg = `Failed to discover ${industry.name} in ${city.name}: ${error.message}`;
        logger.error(errorMsg, error);
        results.push({
          businessesFound: 0,
          businessesCreated: 0,
          businessesUpdated: 0,
          businessesSkipped: 0,
          errors: [errorMsg],
          pagesCrawled: 0,
          searchesExecuted: 0,
        });
      }
    }
  }

  logger.success(`Bulk discovery completed: ${totalRuns} runs, ${results.reduce((sum, r) => sum + r.businessesCreated, 0)} businesses created`);

  return { totalRuns, results };
}
