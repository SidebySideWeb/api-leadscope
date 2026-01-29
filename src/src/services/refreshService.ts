import type { RefreshJobInput, JobResult } from '../types/jobs.js';
import { pool } from '../config/database.js';
import type { Website, CrawlJob, ExtractedContact, CrawlResult } from '../types/index.js';
import { crawlWebsite } from '../workers/crawlerWorker.js';
import { detectContactChanges } from './changeDetector.js';
import { createCrawlJob } from '../db/crawlJobs.js';

/**
 * Run a refresh job
 * This is for recurring, subscription-based refreshes
 * Only re-crawls existing websites and updates contact status
 */
export async function runRefreshJob(input: RefreshJobInput = {}): Promise<JobResult> {
  const startTime = new Date();
  const jobId = `refresh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const batchSize = input.batchSize || 50;
  const maxAgeDays = input.maxAgeDays || 30;

  console.log(`\n🔄 Starting REFRESH job: ${jobId}`);
  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Max age: ${maxAgeDays} days`);

  const errors: string[] = [];
  let totalWebsitesProcessed = 0;
  let contactsAdded = 0;
  let contactsRemoved = 0;
  let contactsVerified = 0;

  try {
    // Select websites that need refreshing
    const websitesResult = await pool.query<Website>(
      `SELECT * FROM websites
       WHERE last_crawled_at IS NULL
          OR last_crawled_at < NOW() - INTERVAL '${maxAgeDays} days'
       ORDER BY last_crawled_at ASC NULLS FIRST
       LIMIT $1`,
      [batchSize]
    );

    const websites = websitesResult.rows;
    console.log(`   Found ${websites.length} websites to refresh`);

    // Process each website
    for (const website of websites) {
      try {
        console.log(`\n   Processing: ${website.url}`);

        // Create or get crawl job
        let crawlJob: CrawlJob;
        const existingJobResult = await pool.query<CrawlJob>(
          `SELECT * FROM crawl_jobs
           WHERE website_id = $1
             AND job_type = 'refresh'
             AND status = 'pending'
           ORDER BY created_at DESC
           LIMIT 1`,
          [website.id]
        );

        if (existingJobResult.rows.length > 0) {
          crawlJob = existingJobResult.rows[0];
        } else {
          crawlJob = await createCrawlJob(website.id);
          // Mark as refresh job
          await pool.query(
            `UPDATE crawl_jobs SET job_type = 'refresh' WHERE id = $1`,
            [crawlJob.id]
          );
        }

        // Crawl the website
        const crawlResults = await crawlWebsite(website, crawlJob);
        totalWebsitesProcessed++;

        if (crawlResults.length === 0) {
          console.log(`      ⚠ No pages crawled`);
          continue;
        }

        // Extract contacts from crawled pages
        const extractedContacts = await extractContactsFromCrawlResults(crawlResults);

        if (extractedContacts.length === 0) {
          console.log(`      ⚠ No contacts extracted`);
          continue;
        }

        // Detect changes
        const changes = await detectContactChanges(
          website,
          crawlResults,
          extractedContacts
        );

        contactsAdded += changes.added;
        contactsVerified += changes.verified;
        contactsRemoved += changes.deactivated;

        console.log(`      ✓ Contacts: +${changes.added} verified:${changes.verified} deactivated:${changes.deactivated}`);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Website ${website.id} (${website.url}): ${errorMsg}`);
        console.error(`      ✗ Error: ${errorMsg}`);
      }
    }

    const endTime = new Date();

    const result: JobResult = {
      jobId,
      jobType: 'refresh',
      startTime,
      endTime,
      totalWebsitesProcessed,
      contactsAdded,
      contactsRemoved,
      contactsVerified,
      errors
    };

    console.log(`\n✅ REFRESH job completed: ${jobId}`);
    console.log(`   Duration: ${(endTime.getTime() - startTime.getTime()) / 1000}s`);
    console.log(`   Websites processed: ${totalWebsitesProcessed}`);
    console.log(`   Contacts added: ${contactsAdded}`);
    console.log(`   Contacts verified: ${contactsVerified}`);
    console.log(`   Contacts deactivated: ${contactsRemoved}`);
    if (errors.length > 0) {
      console.log(`   Errors: ${errors.length}`);
    }

    return result;
  } catch (error) {
    const endTime = new Date();
    const errorMsg = error instanceof Error ? error.message : String(error);
    errors.push(`Refresh job failed: ${errorMsg}`);

    console.error(`\n❌ REFRESH job failed: ${jobId}`);
    console.error(`   Error: ${errorMsg}`);

    return {
      jobId,
      jobType: 'refresh',
      startTime,
      endTime,
      totalWebsitesProcessed,
      contactsAdded,
      contactsRemoved,
      contactsVerified,
      errors
    };
  }
}

/**
 * Extract contacts from crawl results
 * This is a helper that converts CrawlResult[] to ExtractedContact[]
 */
async function extractContactsFromCrawlResults(
  crawlResults: CrawlResult[]
): Promise<ExtractedContact[]> {
  const { extractFromHtml } = await import('../workers/extractorWorker.js');
  const allContacts: ExtractedContact[] = [];

  for (const result of crawlResults) {
    const contacts = extractFromHtml(result.html, result.url);
    allContacts.push(...contacts);
  }

  // Deduplicate by normalized value
  const uniqueContacts = new Map<string, ExtractedContact>();
  for (const contact of allContacts) {
    const key = `${contact.contactType}:${contact.email || contact.phone || contact.mobile}`;
    if (!uniqueContacts.has(key)) {
      uniqueContacts.set(key, contact);
    }
  }

  return Array.from(uniqueContacts.values());
}