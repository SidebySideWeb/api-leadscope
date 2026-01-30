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

  try {
    const business = await getBusinessById(job.business_id);
    if (!business) {
      await updateExtractionJob(job.id, {
        status: 'failed',
        error_message: `Business ${job.business_id} not found`,
        completed_at: new Date()
      });
      return;
    }

    const pages = await getCrawlPagesForBusiness(job.business_id);
    if (pages.length === 0) {
      await updateExtractionJob(job.id, {
        status: 'failed',
        error_message: 'No crawl pages found for business',
        completed_at: new Date()
      });
      return;
    }

    const dedupe = new Set<string>(); // business_id|type|value

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

        // Persist only email / phone as contacts, but always with source_url
        if (item.type === 'email' || item.type === 'phone') {
          try {
            const contactType = item.type === 'email' ? 'email' : 'phone';

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

            await createContactSource({
              contact_id: contactRecord.id,
              source_url: item.sourceUrl,
              page_type: inferPageType(item.sourceUrl, `https://${business.name}`),
              html_hash: page.hash
            });
          } catch (error) {
            console.error(
              `Error persisting contact for business ${job.business_id}:`,
              error
            );
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
    const business = await getBusinessById(job.business_id);
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
    const business = await getBusinessById(job.business_id);
    if (business?.discovery_run_id) {
      await checkAndCompleteDiscoveryRun(business.discovery_run_id);
    }
  }
}

/**
 * Check if all extraction jobs for a discovery_run are complete
 * If so, mark the discovery_run as completed
 * Uses SQL UPDATE with NOT EXISTS pattern to atomically check and update
 * Note: Uses 'queued' instead of 'pending' as that's the actual extraction_job status value
 */
async function checkAndCompleteDiscoveryRun(discoveryRunId: string): Promise<void> {
  try {
    const { pool } = await import('../config/database.js');
    
    // Use UPDATE with NOT EXISTS pattern as specified
    // This atomically checks if any extraction_jobs remain and updates if none do
    // Note: Using 'queued' instead of 'pending' as that's the actual status value
    const updateResult = await pool.query(
      `UPDATE discovery_runs
       SET status = 'completed',
           completed_at = NOW()
       WHERE id = $1
       AND NOT EXISTS (
         SELECT 1
         FROM businesses b
         JOIN extraction_jobs ej ON ej.business_id = b.id
         WHERE b.discovery_run_id = $1
         AND ej.status IN ('queued', 'running')
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
         WHERE b.discovery_run_id = $1
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

