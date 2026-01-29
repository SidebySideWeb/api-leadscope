/**
 * Crawl Worker v1
 * Crawls business websites and extracts contacts
 */

import { resolvePersistence } from '../persistence/index.js';
import { fetchUrl } from '../crawl/fetcher.js';
import { parseHtml } from '../crawl/parser.js';
import { extractEmails, extractPhones, extractSocial } from '../crawl/extractors.js';
import { normalizeUrl, canonicalize, sameRegistrableDomain, extractDomain } from '../crawl/url.js';
import type { CrawlResultV1, CrawlOptions, BusinessWithWebsite, DatasetCrawlSummary } from '../types/crawl.js';
import { logger } from '../utils/logger.js';

const DEFAULT_OPTIONS: Required<CrawlOptions> = {
  maxPages: 15,
  maxDepth: 2,
  concurrency: 3,
  timeout: 12000,
  delayMs: 400
};

/**
 * Crawl a single business website
 */
async function crawlBusiness(
  business: BusinessWithWebsite,
  options: Required<CrawlOptions>
): Promise<CrawlResultV1> {
  const startedAt = new Date().toISOString();
  const websiteUrl = business.website_url!;
  const errors: Array<{ url: string; message: string }> = [];

  const result: CrawlResultV1 = {
    business_id: business.id,
    dataset_id: business.dataset_id,
    website_url: websiteUrl,
    started_at: startedAt,
    finished_at: '',
    pages_visited: 0,
    crawl_status: 'not_crawled',
    emails: [],
    phones: [],
    contact_pages: [],
    social: {},
    errors: []
  };

  try {
    // Normalize and validate URL
    const normalized = normalizeUrl(websiteUrl);
    if (!normalized) {
      throw new Error(`Invalid URL: ${websiteUrl}`);
    }

    const baseDomain = extractDomain(normalized) || '';
    const visited = new Set<string>();
    const queue: Array<{ url: string; depth: number }> = [{ url: normalized, depth: 0 }];
    const allEmails = new Map<string, { value: string; source_url: string; context?: string }>();
    const allPhones = new Map<string, { value: string; source_url: string }>();
    const contactPages = new Set<string>();
    let socialLinks: ReturnType<typeof extractSocial> = {};

    // BFS crawl
    while (queue.length > 0 && visited.size < options.maxPages) {
      const { url, depth } = queue.shift()!;

      // Skip if already visited or too deep
      const canonical = canonicalize(url);
      if (visited.has(canonical) || depth > options.maxDepth) {
        continue;
      }

      visited.add(canonical);

      // Rate limiting: delay between requests
      if (visited.size > 1) {
        await new Promise(resolve => setTimeout(resolve, options.delayMs));
      }

      try {
        // Fetch page
        const fetchResult = await fetchUrl(url, { timeout: options.timeout });
        
        if (fetchResult.status !== 200) {
          errors.push({ url, message: `HTTP ${fetchResult.status}` });
          continue;
        }

        // Parse HTML
        const parsed = parseHtml(fetchResult.content, fetchResult.finalUrl, baseDomain);

        // Extract contacts
        const emails = extractEmails(fetchResult.content, fetchResult.finalUrl, parsed.text);
        for (const email of emails) {
          if (!allEmails.has(email.value)) {
            allEmails.set(email.value, email);
          }
        }

        const phones = extractPhones(fetchResult.content, fetchResult.finalUrl);
        for (const phone of phones) {
          if (!allPhones.has(phone.value)) {
            allPhones.set(phone.value, phone);
          }
        }

        // Extract social (only from homepage)
        if (depth === 0) {
          socialLinks = extractSocial(fetchResult.content, fetchResult.finalUrl);
        }

        // Collect contact pages
        for (const contactUrl of parsed.contactPageUrls) {
          contactPages.add(contactUrl);
        }

        // Add links to queue (if within depth limit)
        if (depth < options.maxDepth) {
          for (const link of parsed.links) {
            if (!visited.has(canonicalize(link)) && sameRegistrableDomain(link, baseDomain)) {
              queue.push({ url: link, depth: depth + 1 });
            }
          }
        }

        // Prioritize contact pages
        const contactQueue = Array.from(contactPages)
          .filter(url => !visited.has(canonicalize(url)) && sameRegistrableDomain(url, baseDomain))
          .slice(0, options.maxPages - visited.size);

        for (const contactUrl of contactQueue) {
          queue.unshift({ url: contactUrl, depth: depth + 1 });
        }

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ url, message });
        logger.debug(`[crawlBusiness] Error crawling ${url}: ${message}`);
      }
    }

    // Determine crawl status
    let crawlStatus: CrawlResultV1['crawl_status'] = 'not_crawled';
    if (visited.size > 0) {
      crawlStatus = visited.size >= options.maxPages ? 'partial' : 'completed';
    }

    result.finished_at = new Date().toISOString();
    result.pages_visited = visited.size;
    result.crawl_status = crawlStatus;
    result.emails = Array.from(allEmails.values());
    result.phones = Array.from(allPhones.values());
    result.contact_pages = Array.from(contactPages);
    result.social = socialLinks;
    result.errors = errors;

    logger.info(`[crawlBusiness] Crawled ${business.name}: ${visited.size} pages, ${allEmails.size} emails, ${allPhones.size} phones`);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push({ url: websiteUrl, message });
    result.finished_at = new Date().toISOString();
    result.crawl_status = 'not_crawled';
    logger.error(`[crawlBusiness] Failed to crawl ${business.name}: ${message}`);
  }

  return result;
}

/**
 * Crawl dataset with concurrency control
 */
export async function crawlDataset(
  datasetId: string,
  options: CrawlOptions = {}
): Promise<DatasetCrawlSummary> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startedAt = new Date().toISOString();

  logger.info(`[crawlDataset] Starting crawl for dataset ${datasetId}`, opts);

  // Get persistence
  const persistence = await resolvePersistence();

  // Load businesses
  const businesses = await persistence.listBusinesses(datasetId, opts.maxPages * 10); // Get more than we'll crawl
  const businessesWithWebsite = businesses.filter(b => b.website_url);

  logger.info(`[crawlDataset] Found ${businessesWithWebsite.length} businesses with websites`);

  if (businessesWithWebsite.length === 0) {
    return {
      dataset_id: datasetId,
      total_businesses: 0,
      crawled: 0,
      failed: 0,
      skipped: 0,
      total_pages: 0,
      total_emails: 0,
      total_phones: 0,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      errors: []
    };
  }

  // Process with concurrency
  const results: CrawlResultV1[] = [];
  const errors: Array<{ business_id: string; error: string }> = [];
  const concurrency = opts.concurrency;

  for (let i = 0; i < businessesWithWebsite.length; i += concurrency) {
    const batch = businessesWithWebsite.slice(i, i + concurrency);
    
    const batchResults = await Promise.allSettled(
      batch.map(business => crawlBusiness(business, opts))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === 'fulfilled') {
        results.push(result.value);
        await persistence.upsertCrawlResult(result.value);
      } else {
        const business = batch[j];
        const error = result.reason instanceof Error ? result.reason.message : 'Unknown error';
        errors.push({ business_id: business.id, error });
        logger.error(`[crawlDataset] Failed to crawl business ${business.id}: ${error}`);
      }
    }

    logger.info(`[crawlDataset] Progress: ${Math.min(i + concurrency, businessesWithWebsite.length)}/${businessesWithWebsite.length}`);
  }

  // Calculate summary
  const totalPages = results.reduce((sum, r) => sum + r.pages_visited, 0);
  const totalEmails = results.reduce((sum, r) => sum + r.emails.length, 0);
  const totalPhones = results.reduce((sum, r) => sum + r.phones.length, 0);
  const crawled = results.filter(r => r.crawl_status !== 'not_crawled').length;
  const failed = results.filter(r => r.crawl_status === 'not_crawled' && r.errors.length > 0).length;

  const summary: DatasetCrawlSummary = {
    dataset_id: datasetId,
    total_businesses: businessesWithWebsite.length,
    crawled,
    failed,
    skipped: businessesWithWebsite.length - crawled - failed,
    total_pages: totalPages,
    total_emails: totalEmails,
    total_phones: totalPhones,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    errors
  };

  // Save summary
  await persistence.saveSummary(summary);

  logger.info(`[crawlDataset] Completed: ${crawled} crawled, ${failed} failed, ${totalEmails} emails, ${totalPhones} phones`);

  return summary;
}
