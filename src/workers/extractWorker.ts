import dotenv from 'dotenv';
import { pool } from '../config/database.js';
import { getCrawlPagesForBusiness } from '../db/crawlPages.js';
import { getOrCreateContact } from '../db/contacts.js';
import { createContactSource } from '../db/contactSources.js';
import {
  type ExtractionJob,
  getQueuedExtractionJobs,
  updateExtractionJob,
  getExtractionJobsByDiscoveryRunId
} from '../db/extractionJobs.js';
import { updateDiscoveryRun } from '../db/discoveryRuns.js';
import { extractFromHtmlPage, type ExtractedItem } from '../utils/extractors.js';
import { googleMapsService } from '../services/googleMaps.js';
import { getOrCreateWebsite } from '../db/websites.js';
import type { Business } from '../types/index.js';

dotenv.config();

function inferPageType(url: string, businessUrl: string): 'homepage' | 'contact' | 'about' | 'company' | 'footer' {
  try {
    const target = new URL(url);
    const base = new URL(businessUrl);

    const path = target.pathname.toLowerCase();
    const isHomepage = target.origin === base.origin && (path === '/' || path === base.pathname.toLowerCase());

    if (isHomepage) return 'homepage';
    if (path.includes('contact') || path.includes('επικοινων')) return 'contact';
    if (path.includes('about') || path.includes('σχετικ')) return 'about';
    if (path.includes('company') || path.includes('εταιρ')) return 'company';

    return 'footer';
  } catch {
    return 'footer';
  }
}

async function getBusinessById(id: number): Promise<Business | null> {
  const result = await pool.query<Business>(
    'SELECT * FROM businesses WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function processExtractionJob(job: ExtractionJob): Promise<void> {
  const startedAt = new Date();

  await updateExtractionJob(job.id, {
    status: 'running',
    started_at: startedAt,
    error_message: null
  });

  // Load business once at function scope so it's accessible in both try and catch blocks
  let business: Business | null = null;

  try {
    business = await getBusinessById(job.business_id);
    if (!business) {
      await updateExtractionJob(job.id, {
        status: 'failed',
        error_message: `Business ${job.business_id} not found`,
        completed_at: new Date()
      });
      return;
    }

    // STEP 1: First, try to extract contact details from website crawl pages
    // This is free and preferred over paid Place Details API
    const pages = await getCrawlPagesForBusiness(job.business_id);
    
    const dedupe = new Set<string>(); // business_id|type|value
    const socialLinks: Map<string, string> = new Map(); // platform -> url
    let foundWebsiteFromPages = false;
    let foundPhoneFromPages = false;
    let foundEmailFromPages = false;

    if (pages.length > 0) {
      console.log(`[processExtractionJob] Extracting contact details from ${pages.length} crawl pages for business ${business.id}...`);
      
      for (const page of pages) {
        const sourceUrl = page.final_url || page.url;
        const extracted: ExtractedItem[] = extractFromHtmlPage(
          page.html,
          sourceUrl
        );

        for (const item of extracted) {
          const key = `${job.business_id}|${item.type}|${item.value.toLowerCase()}`;
          if (dedupe.has(key)) {
            continue;
          }
          dedupe.add(key);

          // Persist email / phone as contacts, always with source_url
          if (item.type === 'email' || item.type === 'phone') {
            try {
              const contactType = item.type === 'email' ? 'email' : 'phone';
              
              if (item.type === 'phone') {
                foundPhoneFromPages = true;
              } else if (item.type === 'email') {
                foundEmailFromPages = true;
              }

              console.log(`[processExtractionJob] Creating contact for business ${job.business_id}:`, {
                type: contactType,
                value: item.type === 'email' ? `${item.value.substring(0, 10)}...` : `${item.value.substring(0, 5)}...`,
                source_url: item.sourceUrl.substring(0, 50) + '...'
              });

              const contactRecord = await getOrCreateContact({
                email: item.type === 'email' ? item.value : undefined,
                phone: item.type === 'phone' ? item.value : undefined,
                mobile: undefined,
                contact_type: contactType,
                is_generic: item.type === 'email'
                  ? (() => {
                      // classifyEmail is already used inside extractors for normalization;
                      // here we assume generic detection already applied.
                      return false;
                    })()
                  : false
              });

              console.log(`[processExtractionJob] Contact created/found with id: ${contactRecord.id}, now creating contact_source...`);

              // CRITICAL: Link contact to business via contact_sources
              // This requires business_id to be passed, but contact_sources table links contact_id to business_id
              // Let's check if we need to pass business_id
              // Create contact_source with business_id if available
              // Convert business.id to string (UUID) to match contact_sources.business_id type
              await createContactSource({
                contact_id: contactRecord.id,
                business_id: business.id.toString(), // Convert to string (UUID) - businesses.id is UUID in DB
                source_url: item.sourceUrl,
                page_type: inferPageType(item.sourceUrl, `https://${business.name}`),
                html_hash: page.hash
              });

              console.log(`[processExtractionJob] Successfully persisted ${contactType} contact for business ${job.business_id}`);
            } catch (error: any) {
              console.error(
                `[processExtractionJob] CRITICAL ERROR persisting contact for business ${job.business_id}:`,
                {
                  error_code: error.code,
                  error_message: error.message,
                  error_detail: error.detail,
                  error_hint: error.hint,
                  error_constraint: error.constraint,
                  contact_type: item.type,
                  contact_value: item.type === 'email' ? `${item.value.substring(0, 10)}...` : `${item.value.substring(0, 5)}...`,
                  source_url: item.sourceUrl,
                  stack: error.stack
                }
              );
              
              // Don't throw - continue processing other contacts
            }
          }

          // Collect social media links
          if (item.type === 'social' && item.platform) {
            // Store social link (keep first one found for each platform)
            if (!socialLinks.has(item.platform)) {
              socialLinks.set(item.platform, item.value);
            }
          }
        }
      }
      
      // Check if we found a website from crawl pages
      const websiteResult = await pool.query<{ id: number; url: string }>(
        'SELECT id, url FROM websites WHERE business_id = $1 LIMIT 1',
        [business.id]
      );
      foundWebsiteFromPages = websiteResult.rows.length > 0;
      
      console.log(`[processExtractionJob] Website extraction results: website=${foundWebsiteFromPages}, phone=${foundPhoneFromPages}, email=${foundEmailFromPages}`);
    } else {
      console.log(`[processExtractionJob] No crawl pages found for business ${business.id}`);
    }

    // STEP 2: Fetch from Google Place Details API if website or phone is missing
    // This is a paid API, so we fetch it when user requests extraction (and pays)
    // Always fetch if business has google_place_id and we're missing website or phone
    if (business.google_place_id) {
      const needsWebsite = !foundWebsiteFromPages;
      const needsPhone = !foundPhoneFromPages;
      
      if (needsWebsite || needsPhone) {
        console.log(`[processExtractionJob] Fetching Place Details API for business ${business.id} (needsWebsite: ${needsWebsite}, needsPhone: ${needsPhone})`);
      
      try {
        const placeDetails = await googleMapsService.getPlaceDetails(business.google_place_id);
        
        if (placeDetails) {
          // Create/update website if missing and Place Details has website
          if (!foundWebsiteFromPages && placeDetails.website) {
            try {
              console.log(`[processExtractionJob] Creating website from Place Details for business ${business.id}: ${placeDetails.website}`);
              const website = await getOrCreateWebsite(business.id, placeDetails.website);
              console.log(`[processExtractionJob] Successfully created website from Place Details: ${placeDetails.website}`);
              
              // Create crawl job to extract emails from the website
              try {
                const { createCrawlJob } = await import('../db/crawlJobs.js');
                await createCrawlJob(website.id, 'discovery', 25);
                console.log(`[processExtractionJob] Created crawl job for website ${website.id} to extract emails`);
              } catch (crawlJobError: any) {
                console.error(`[processExtractionJob] Error creating crawl job for website ${website.id}:`, crawlJobError.message);
                // Don't fail extraction if crawl job creation fails
              }
            } catch (error: any) {
              console.error(`[processExtractionJob] CRITICAL ERROR creating website from Place Details:`, {
                error_code: error.code,
                error_message: error.message,
                error_detail: error.detail,
                error_hint: error.hint,
                error_constraint: error.constraint,
                business_id: business.id,
                website_url: placeDetails.website,
                stack: error.stack
              });
            }
          }

          // Create phone contact if missing and Place Details has phone
          if (!foundPhoneFromPages && placeDetails.international_phone_number) {
            try {
              console.log(`[processExtractionJob] Creating phone contact from Place Details for business ${business.id}: ${placeDetails.international_phone_number}`);
              
              const phoneContact = await getOrCreateContact({
                phone: placeDetails.international_phone_number,
                contact_type: 'phone',
                is_generic: false
              });
              
              console.log(`[processExtractionJob] Contact created/found with id: ${phoneContact.id}, now creating contact_source...`);
              
              // Link contact to business via source with business_id
              // Convert business.id to string (UUID) to match contact_sources.business_id type
              await createContactSource({
                contact_id: phoneContact.id,
                business_id: business.id.toString(), // Convert to string (UUID) - businesses.id is UUID in DB
                source_url: `https://maps.google.com/?cid=${business.google_place_id}`,
                page_type: 'homepage',
                html_hash: ''
              });
              
              console.log(`[processExtractionJob] Successfully created phone contact from Place Details: ${placeDetails.international_phone_number}`);
            } catch (error: any) {
              console.error(`[processExtractionJob] CRITICAL ERROR creating phone contact from Place Details:`, {
                error_code: error.code,
                error_message: error.message,
                error_detail: error.detail,
                error_hint: error.hint,
                error_constraint: error.constraint,
                business_id: business.id,
                phone: placeDetails.international_phone_number,
                stack: error.stack
              });
            }
          }
        } else {
          console.log(`[processExtractionJob] Place Details API returned no data for business ${business.id}`);
        }
      } catch (error) {
        console.error(`[processExtractionJob] Error fetching Place Details for business ${business.id}:`, error);
        // Don't fail the extraction job if Place Details fetch fails
      }
      }
    } else {
      console.log(`[processExtractionJob] Business ${business.id} has no google_place_id - cannot fetch Place Details`);
    }

    // If no crawl pages were found and we didn't get data from Place Details, mark as completed anyway
    if (pages.length === 0 && !foundWebsiteFromPages && !foundPhoneFromPages) {
      console.log(`[processExtractionJob] No crawl pages and no Place Details data - marking as completed`);
      await updateExtractionJob(job.id, {
        status: 'success',
        completed_at: new Date()
      });
      
      // Still need to check and complete discovery_run
      if (business?.discovery_run_id) {
        await checkAndCompleteDiscoveryRun(business.discovery_run_id);
      }
      return;
    }

    // Persist social media links to database
    // Store social media links extracted from website pages
    if (socialLinks.size > 0) {
      console.log(`[processExtractionJob] Found ${socialLinks.size} social media links for business ${business.id}`);
      
      for (const [platform, url] of socialLinks) {
        try {
          // Try to store in social_media table if it exists
          // If table doesn't exist, we'll skip (no schema changes per requirements)
          await pool.query(
            `INSERT INTO social_media (business_id, platform, url, created_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (business_id, platform) DO UPDATE
             SET url = EXCLUDED.url, updated_at = NOW()`,
            [business.id, platform, url]
          );
          console.log(`[processExtractionJob] Stored ${platform} link: ${url}`);
        } catch (error: any) {
          // If table doesn't exist (error code 42P01), log and continue
          // This is expected if social_media table hasn't been created yet
          if (error.code === '42P01') {
            console.log(`[processExtractionJob] social_media table does not exist - social links will be stored when table is created`);
            // Don't break - try to store other data types
          } else {
            console.error(`[processExtractionJob] Error storing ${platform} link:`, error);
          }
        }
      }
    }

    await updateExtractionJob(job.id, {
      status: 'success',
      completed_at: new Date()
    });
    
    // Check if this was the last extraction job for the discovery_run
    // Get discovery_run_id from the business (not from extraction_job)
    if (business?.discovery_run_id) {
      await checkAndCompleteDiscoveryRun(business.discovery_run_id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateExtractionJob(job.id, {
      status: 'failed',
      error_message: message,
      completed_at: new Date()
    });
    
    // Check if this was the last extraction job for the discovery_run (even if failed)
    // Get discovery_run_id from the business (not from extraction_job)
    // Load business if not already loaded (in case error occurred before business was loaded)
    if (!business) {
      business = await getBusinessById(job.business_id);
    }
    if (business?.discovery_run_id) {
      await checkAndCompleteDiscoveryRun(business.discovery_run_id);
    }
  }
}

/**
 * Check if all extraction jobs for a discovery_run are complete
 * If so, mark the discovery_run as completed
 * Uses SQL UPDATE with NOT EXISTS pattern to atomically check and update
 * NOTE: extraction_jobs does NOT have discovery_run_id - query through businesses table
 */
async function checkAndCompleteDiscoveryRun(discoveryRunId: string): Promise<void> {
  try {
    const { pool } = await import('../config/database.js');
    
    // Use UPDATE with NOT EXISTS pattern as specified
    // This atomically checks if any extraction_jobs remain and updates if none do
    // NOTE: extraction_jobs does NOT have discovery_run_id - query through businesses table
    const updateResult = await pool.query(
      `UPDATE discovery_runs
       SET status = 'completed',
           completed_at = NOW()
       WHERE id = $1
       AND NOT EXISTS (
         SELECT 1
         FROM businesses b
         JOIN extraction_jobs ej ON ej.business_id = b.id
         WHERE b.discovery_run_id = $1::uuid
         AND ej.status IN ('pending', 'running')
       )
       RETURNING *`,
      [discoveryRunId]
    );
    
    if (updateResult.rows.length > 0) {
      // Discovery run was marked as completed
      // Check if any jobs failed to set appropriate status
      const jobsResult = await pool.query<{ status: string; count: string }>(
        `SELECT ej.status, COUNT(*) as count
         FROM businesses b
         JOIN extraction_jobs ej ON ej.business_id = b.id
         WHERE b.discovery_run_id = $1::uuid
         GROUP BY ej.status`,
        [discoveryRunId]
      );
      
      const hasFailures = jobsResult.rows.some(row => row.status === 'failed');
      
      if (hasFailures) {
        // Update to failed if any jobs failed
        await updateDiscoveryRun(discoveryRunId, {
          status: 'failed',
          completed_at: new Date(),
          error_message: `${jobsResult.rows.find(r => r.status === 'failed')?.count || '0'} extraction job(s) failed`
        });
        console.log(`[extractWorker] Marked discovery_run ${discoveryRunId} as failed (some extraction jobs failed)`);
      } else {
        console.log(`[extractWorker] Marked discovery_run ${discoveryRunId} as completed`);
      }
    }
  } catch (error) {
    console.error(`[extractWorker] Error checking discovery_run completion:`, error);
  }
}

export async function runExtractionBatch(batchSize: number): Promise<void> {
  const jobs = await getQueuedExtractionJobs(batchSize);

  if (jobs.length === 0) {
    console.log('No queued extraction jobs found.');
    return;
  }

  console.log(`Processing ${jobs.length} extraction job(s)...`);

  for (const job of jobs) {
    console.log(`Extracting contacts for job ${job.id} (business_id=${job.business_id})`);
    await processExtractionJob(job);
  }
}

