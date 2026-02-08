/**
 * Optimized Vrisko Discovery Worker
 * 
 * Features:
 * - Database-driven job queue
 * - Concurrent processing with configurable concurrency
 * - Batching for efficient database operations
 * - Progress tracking and resumability
 * - Automatic retry on failure
 */

import { pool } from '../config/database.js';
import { getCityById } from '../db/cities.js';
import { getIndustryById } from '../db/industries.js';
import { getDatasetById } from '../db/datasets.js';
import {
  getPendingVriskoDiscoveryJobs,
  claimVriskoDiscoveryJob,
  updateVriskoDiscoveryJobProgress,
  completeVriskoDiscoveryJob,
  failVriskoDiscoveryJob,
  type VriskoDiscoveryJob,
} from '../db/vriskoDiscoveryJobs.js';
import { VriskoCrawler } from '../crawler/vrisko/vriskoCrawler.js';
import { upsertBusinessGlobal, linkBusinessToDataset } from '../db/businessesShared.js';
import { getOrCreateWebsite } from '../db/websites.js';
import { getOrCreateContact } from '../db/contacts.js';
import { createContactSource } from '../db/contactSources.js';
import { updateDiscoveryRun } from '../db/discoveryRuns.js';
import type { VriskoBusiness } from '../crawler/vrisko/vriskoParser.js';
import { Logger } from '../crawler/vrisko/utils/logger.js';
import pLimit from 'p-limit';

const logger = new Logger('VriskoDiscoveryWorker');

// Configuration from environment
const CONCURRENCY = parseInt(process.env.VRISKO_DISCOVERY_CONCURRENCY || '3', 10);
const BATCH_SIZE = parseInt(process.env.VRISKO_DISCOVERY_BATCH_SIZE || '5', 10);
const POLL_INTERVAL_MS = parseInt(process.env.VRISKO_DISCOVERY_POLL_INTERVAL || '5000', 10);
const MAX_PAGES_PER_KEYWORD = parseInt(process.env.VRISKO_DISCOVERY_MAX_PAGES || '50', 10);

/**
 * Process a single vrisko discovery job
 */
async function processVriskoDiscoveryJob(job: VriskoDiscoveryJob): Promise<void> {
  logger.info(`Processing job ${job.id}: city=${job.city_id}, industry=${job.industry_id}`);

  try {
    // Get city, industry, and dataset
    const [city, industry, dataset] = await Promise.all([
      getCityById(job.city_id),
      getIndustryById(job.industry_id),
      getDatasetById(job.dataset_id),
    ]);

    if (!city) {
      throw new Error(`City ${job.city_id} not found`);
    }
    if (!industry) {
      throw new Error(`Industry ${job.industry_id} not found`);
    }
    if (!dataset) {
      throw new Error(`Dataset ${job.dataset_id} not found`);
    }

    // Check if active (gracefully handle missing field)
    const cityIsActive = (city as any).is_active !== false;
    const industryIsActive = (industry as any).is_active !== false;

    if (!cityIsActive || !industryIsActive) {
      await completeVriskoDiscoveryJob(job.id, {
        businesses_found: 0,
        businesses_created: 0,
        businesses_updated: 0,
      });
      logger.warn(`Job ${job.id} skipped: city or industry not active`);
      return;
    }

    // Determine search keywords from metadata or industry
    let searchKeywords: string[] = [];
    let locationString: string;

    if (job.metadata?.keywords && Array.isArray(job.metadata.keywords)) {
      // Use keywords from metadata if available
      searchKeywords = job.metadata.keywords;
      locationString = job.metadata.location || city.name;
    } else {
      // Generate keywords from industry
      const primaryKeyword = (industry as any).vrisko_keyword || industry.name;
      if (primaryKeyword) {
        searchKeywords.push(primaryKeyword);
      }

      // Add discovery_keywords
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

      locationString = (city as any).vrisko_search || city.name;
    }

    if (searchKeywords.length === 0) {
      throw new Error(`No search keywords found for industry ${industry.name}`);
    }

    // Update total keywords
    await updateVriskoDiscoveryJobProgress(job.id, {
      total_keywords: searchKeywords.length,
    });

    logger.info(`Job ${job.id}: Searching ${searchKeywords.length} keywords in "${locationString}"`);

    // Initialize crawler with concurrency
    const crawler = new VriskoCrawler({
      maxPages: MAX_PAGES_PER_KEYWORD,
      concurrency: 1, // Per-keyword concurrency (handled by pLimit below)
      delayBetweenPages: true,
    });

    // Process keywords with concurrency control
    const limit = pLimit(CONCURRENCY);
    const seenBusinesses = new Map<string, VriskoBusiness>();
    let totalPages = 0;
    let completedKeywords = 0;
    let businessesCreated = 0;
    let businessesUpdated = 0;

    // Process keywords concurrently
    const keywordPromises = searchKeywords.map((keyword, index) =>
      limit(async () => {
        try {
          logger.info(`Job ${job.id}: Searching keyword ${index + 1}/${searchKeywords.length}: "${keyword}"`);

          const vriskoResults = await crawler.crawl(keyword, locationString, MAX_PAGES_PER_KEYWORD);
          totalPages += Math.ceil(vriskoResults.length / 20); // Approximate pages

          // Update progress
          completedKeywords++;
          await updateVriskoDiscoveryJobProgress(job.id, {
            completed_keywords: completedKeywords,
            total_pages: totalPages,
            completed_pages: totalPages, // Approximate
          });

          // Deduplicate businesses
          for (const business of vriskoResults) {
            const key = `${business.name.toLowerCase().trim()}_${business.address.city}`;
            if (!seenBusinesses.has(key)) {
              seenBusinesses.set(key, business);
            }
          }

          logger.info(`Job ${job.id}: Keyword "${keyword}" found ${vriskoResults.length} businesses (${seenBusinesses.size} unique so far)`);
        } catch (error: any) {
          logger.error(`Job ${job.id}: Keyword "${keyword}" failed: ${error.message}`, error);
          // Continue with other keywords
        }
      })
    );

    await Promise.all(keywordPromises);

    logger.info(`Job ${job.id}: Total unique businesses found: ${seenBusinesses.size}`);

    // Update businesses found
    await updateVriskoDiscoveryJobProgress(job.id, {
      businesses_found: seenBusinesses.size,
    });

    // Process businesses in batches for efficient database operations
    const businessArray = Array.from(seenBusinesses.values());
    const batchLimit = pLimit(BATCH_SIZE); // Limit concurrent database operations

    const businessPromises = businessArray.map((vriskoBusiness) =>
      batchLimit(async () => {
        try {
          // Generate unique ID
          const uniqueId = `${vriskoBusiness.name}_${vriskoBusiness.address.street}_${vriskoBusiness.address.city}_${vriskoBusiness.address.postal_code}`;
          const googlePlaceId = `vrisko_${Buffer.from(uniqueId).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 50)}`;

          // Upsert business
          const { business, wasNew, wasUpdated } = await upsertBusinessGlobal({
            name: vriskoBusiness.name,
            address: `${vriskoBusiness.address.street}, ${vriskoBusiness.address.city} ${vriskoBusiness.address.postal_code}`.trim(),
            postal_code: vriskoBusiness.address.postal_code || null,
            city_id: job.city_id,
            industry_id: job.industry_id,
            dataset_id: job.dataset_id,
            google_place_id: googlePlaceId,
            owner_user_id: dataset.user_id,
            discovery_run_id: job.discovery_run_id || null,
            latitude: vriskoBusiness.location.latitude || null,
            longitude: vriskoBusiness.location.longitude || null,
          });

          if (wasNew) {
            businessesCreated++;
          } else if (wasUpdated) {
            businessesUpdated++;
          }

          // Link to dataset
          await linkBusinessToDataset(business.id, job.dataset_id, dataset.user_id);

          // Store website
          if (vriskoBusiness.website) {
            try {
              await getOrCreateWebsite(business.id, vriskoBusiness.website);
            } catch (error: any) {
              logger.warn(`Job ${job.id}: Failed to create website for business ${business.id}: ${error.message}`);
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
              logger.warn(`Job ${job.id}: Failed to create phone contact: ${error.message}`);
            }
          }

          // Store email
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
              logger.warn(`Job ${job.id}: Failed to create email contact: ${error.message}`);
            }
          }

          // Update progress periodically
          if ((businessesCreated + businessesUpdated) % 10 === 0) {
            await updateVriskoDiscoveryJobProgress(job.id, {
              businesses_created: businessesCreated,
              businesses_updated: businessesUpdated,
            });
          }
        } catch (error: any) {
          logger.error(`Job ${job.id}: Failed to process business "${vriskoBusiness.name}": ${error.message}`, error);
        }
      })
    );

    await Promise.all(businessPromises);

    // Final progress update
    await updateVriskoDiscoveryJobProgress(job.id, {
      businesses_created: businessesCreated,
      businesses_updated: businessesUpdated,
    });

    // Mark job as completed
    await completeVriskoDiscoveryJob(job.id, {
      businesses_found: seenBusinesses.size,
      businesses_created: businessesCreated,
      businesses_updated: businessesUpdated,
    });

    // Update discovery run if linked
    if (job.discovery_run_id) {
      try {
        await updateDiscoveryRun(job.discovery_run_id, {
          status: 'completed',
          completed_at: new Date(),
        });
      } catch (error: any) {
        logger.warn(`Job ${job.id}: Failed to update discovery run: ${error.message}`);
      }
    }

    logger.success(`Job ${job.id} completed: ${businessesCreated} created, ${businessesUpdated} updated`);

  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Job ${job.id} failed: ${errorMsg}`, error);
    await failVriskoDiscoveryJob(job.id, errorMsg, true);
    throw error;
  }
}

/**
 * Process jobs from the queue
 * This is the main worker loop
 */
export async function processVriskoDiscoveryQueue(): Promise<void> {
  logger.info(`Starting vrisko discovery queue processor (concurrency: ${CONCURRENCY}, batch size: ${BATCH_SIZE})`);

  const limit = pLimit(CONCURRENCY);

  while (true) {
    try {
      // Get pending jobs
      const pendingJobs = await getPendingVriskoDiscoveryJobs(CONCURRENCY * 2); // Get more than concurrency for batching

      if (pendingJobs.length === 0) {
        // No jobs, wait before polling again
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }

      logger.info(`Found ${pendingJobs.length} pending jobs`);

      // Process jobs concurrently
      const jobPromises = pendingJobs.map((job) =>
        limit(async () => {
          // Try to claim the job (atomic operation)
          const claimedJob = await claimVriskoDiscoveryJob(job.id);

          if (!claimedJob) {
            // Job was already claimed by another worker
            logger.info(`Job ${job.id} already claimed by another worker`);
            return;
          }

          try {
            await processVriskoDiscoveryJob(claimedJob);
          } catch (error: any) {
            logger.error(`Job ${claimedJob.id} processing failed: ${error.message}`, error);
            // Job will be marked as failed or retried by processVriskoDiscoveryJob
          }
        })
      );

      await Promise.all(jobPromises);

      // Small delay between batches to avoid overwhelming the database
      await new Promise((resolve) => setTimeout(resolve, 1000));

    } catch (error: any) {
      logger.error(`Queue processor error: ${error.message}`, error);
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

/**
 * Start the worker (for use in CLI or service)
 */
export async function startVriskoDiscoveryWorker(): Promise<void> {
  logger.info('Starting vrisko discovery worker...');
  await processVriskoDiscoveryQueue();
}
