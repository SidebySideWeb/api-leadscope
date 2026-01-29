/**
 * Crawl Worker v1
 * 
 * Responsibilities:
 * - Fetch HTML pages
 * - Extract: emails, phone numbers, contact page URL
 * - Respect crawl depth limits from pricing gates
 * - Store partial results even if gated
 * 
 * Do NOT:
 * - Follow infinite links
 * - Crawl blog posts
 * - Do SEO analysis
 */

import { pool } from '../config/database.js';
import { fetchUrl } from '../crawl/fetcher.js';
import { parseHtml, isContactPage } from '../crawl/parser.js';
import { extractEmails, extractPhones, extractSocial } from '../crawl/extractors.js';
import { normalizeUrl, canonicalize, sameRegistrableDomain, extractDomain } from '../crawl/url.js';
import { enforceCrawlLimits, type UserPlan } from '../limits/enforcePlanLimits.js';
import { checkUsageLimit } from '../limits/usageLimits.js';
import { getUserPermissions } from '../db/permissions.js';
import { getUserUsage, incrementUsage } from '../persistence/index.js';
import { 
  MAX_PAGES_PER_CRAWL, 
  MAX_CONCURRENT_CRAWLS, 
  CRAWL_TIMEOUT_MS,
  applySafetyCaps 
} from '../limits/safetyLimits.js';
import { acquireCrawlSlot } from './crawlConcurrency.js';
import { logCrawlAction } from '../utils/actionLogger.js';
import type { CrawlResultV1, CrawlStatus } from '../types/crawl.js';
// Hash not needed for crawl results storage

export interface CrawlWorkerV1Input {
  businessId: number; // Integer business ID
  datasetId: string; // UUID
  websiteUrl: string;
  userId: string; // User ID - plan is resolved from database (source of truth)
  // userPlan removed - always resolved from database via getUserPermissions()
}

export interface CrawlWorkerV1Result {
  success: boolean;
  business_id: number;
  dataset_id: string;
  website_url: string;
  pages_visited: number;
  pages_limit: number;
  gated: boolean;
  crawl_status: CrawlStatus;
  emails_found: number;
  phones_found: number;
  contact_pages_found: number;
  error?: string;
  upgrade_hint?: string;
}

// Patterns to skip (blog posts, SEO pages, etc.)
const SKIP_PATTERNS = [
  /\/blog\//i,
  /\/news\//i,
  /\/articles\//i,
  /\/category\//i,
  /\/tag\//i,
  /\/author\//i,
  /\/archive\//i,
  /\/search\//i,
  /\/sitemap/i,
  /\.xml$/i,
  /\.rss$/i,
  /\.json$/i,
  /\/feed\//i,
];

/**
 * Check if URL should be skipped
 */
function shouldSkipUrl(url: string): boolean {
  const urlLower = url.toLowerCase();
  return SKIP_PATTERNS.some(pattern => pattern.test(urlLower));
}

/**
 * Crawl Worker v1 - Main function
 */
export async function crawlWorkerV1(
  input: CrawlWorkerV1Input
): Promise<CrawlWorkerV1Result> {
  const { businessId, datasetId, websiteUrl, userId } = input;
  const crawlStartTime = Date.now();
  const startedAt = new Date().toISOString();
  let releaseCrawlSlot: (() => void) | null = null;

  try {
    // 0. Acquire crawl slot (hard limit: MAX_CONCURRENT_CRAWLS = 1)
    releaseCrawlSlot = await acquireCrawlSlot();

    // 1. Get user permissions from database (source of truth: Stripe subscription)
    // Never trust client payload - always query database
    const permissions = await getUserPermissions(userId);
    const userPlan = permissions.plan;
    const isInternalUser = permissions.is_internal_user; // Server-side only
    const maxCrawlDepth = isInternalUser ? 10 : permissions.max_crawl_pages; // Internal users get max depth

    // 2. Check monthly usage limit (never throws - graceful degradation)
    // Internal users bypass usage limits
    const usage = await getUserUsage(userId);
    const usageCheck = checkUsageLimit(userPlan, 'crawl', usage.crawls_this_month, isInternalUser);
    
    if (!usageCheck.allowed) {
      // Log action (usage limit exceeded)
      logCrawlAction({
        userId,
        datasetId,
        resultSummary: `Crawl blocked: usage limit exceeded (${usage.crawls_this_month}/${usageCheck.limit} crawls this month)`,
        gated: true,
        error: usageCheck.reason || 'Usage limit exceeded',
        metadata: {
          business_id: businessId,
          website_url: websiteUrl,
          usage_count: usage.crawls_this_month,
          usage_limit: usageCheck.limit,
          upgrade_hint: usageCheck.upgrade_hint,
        },
      });

      // Return partial result with usage limit info
      return {
        success: false,
        business_id: businessId,
        dataset_id: datasetId,
        website_url: websiteUrl,
        pages_visited: 0,
        pages_limit: 0,
        gated: true,
        crawl_status: 'not_crawled',
        emails_found: 0,
        phones_found: 0,
        contact_pages_found: 0,
        error: usageCheck.reason,
        upgrade_hint: usageCheck.upgrade_hint,
      };
    }

    // 3. Apply safety caps (hard limits that cannot be overridden)
    // These are checked BEFORE plan-based limits
    const planMaxPages = Math.min(maxCrawlDepth * 10, 50); // Estimate pages from depth
    const safetyCaps = applySafetyCaps({
      maxPages: planMaxPages,
      timeoutMs: 12000, // Default per-page timeout
    });

    // Use safety-capped values
    const maxPages = safetyCaps.maxPages; // Capped at MAX_PAGES_PER_CRAWL (50)
    const perPageTimeout = Math.min(12000, safetyCaps.timeoutMs); // Per-page timeout (12s max)

    // 4. Normalize and validate URL
    const normalized = normalizeUrl(websiteUrl);
    if (!normalized) {
      return {
        success: false,
        business_id: businessId,
        dataset_id: datasetId,
        website_url: websiteUrl,
        pages_visited: 0,
        pages_limit: maxPages,
        gated: false,
        crawl_status: 'not_crawled',
        emails_found: 0,
        phones_found: 0,
        contact_pages_found: 0,
        error: `Invalid URL: ${websiteUrl}`,
      };
    }

    const baseDomain = extractDomain(normalized) || '';
    const visited = new Set<string>();
    const queue: Array<{ url: string; depth: number }> = [{ url: normalized, depth: 0 }];
    
    const allEmails = new Map<string, { value: string; source_url: string; context?: string }>();
    const allPhones = new Map<string, { value: string; source_url: string }>();
    const contactPages = new Set<string>();
    let socialLinks: ReturnType<typeof extractSocial> = {};
    const errors: Array<{ url: string; message: string }> = [];
    let safetyLimitExceeded = false;
    let safetyLimitReason: string | undefined;

    // 3. BFS crawl with depth, page limits, and timeout
    while (queue.length > 0 && visited.size < maxPages) {
      // Check total crawl timeout (hard limit)
      const elapsed = Date.now() - crawlStartTime;
      if (elapsed >= CRAWL_TIMEOUT_MS) {
        safetyLimitExceeded = true;
        safetyLimitReason = `Safety limit: Crawl timeout exceeded (${CRAWL_TIMEOUT_MS}ms)`;
        console.warn(`[crawlWorkerV1] ${safetyLimitReason} for ${websiteUrl}`);
        break; // Stop gracefully
      }
      const { url, depth } = queue.shift()!;

      // Skip if already visited, too deep, or should be skipped
      const canonical = canonicalize(url);
      if (visited.has(canonical)) {
        continue;
      }

      // Check depth limit (max depth 2 to avoid infinite links)
      const maxDepth = 2;
      if (depth > maxDepth) {
        continue;
      }

      // Skip blog posts, SEO pages, etc.
      if (shouldSkipUrl(canonical)) {
        continue;
      }

      visited.add(canonical);

      // Rate limiting: delay between requests (except first)
      if (visited.size > 1) {
        await new Promise(resolve => setTimeout(resolve, 400));
      }

      try {
        // Fetch page with safety-capped timeout
        const fetchResult = await fetchUrl(url, { timeout: perPageTimeout });
        
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

        // Extract social links (only from homepage)
        if (depth === 0) {
          socialLinks = extractSocial(fetchResult.content, fetchResult.finalUrl);
        }

        // Check if this is a contact page
        if (isContactPage(fetchResult.finalUrl)) {
          contactPages.add(fetchResult.finalUrl);
        }

        // Add contact page URLs from parsed links
        for (const contactUrl of parsed.contactPageUrls) {
          contactPages.add(contactUrl);
        }

        // Add new links to queue (only same domain, not too deep, not skipped)
        for (const link of parsed.links) {
          if (visited.size >= maxPages) {
            break; // Stop if we've hit the page limit
          }

          if (shouldSkipUrl(link)) {
            continue;
          }

          if (sameRegistrableDomain(link, baseDomain) && !visited.has(canonicalize(link))) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      } catch (error: any) {
        errors.push({ url, message: error.message || 'Fetch failed' });
        continue;
      }
    }

    // 4. Determine crawl status and gating
    // Safety limits take precedence - if exceeded, mark as partial and do not retry
    let crawlStatus: CrawlStatus = 'completed';
    const hitPageLimit = visited.size >= maxPages && queue.length > 0;
    const hitTimeout = safetyLimitExceeded;
    const isGated = hitPageLimit || hitTimeout;
    
    if (visited.size === 0) {
      crawlStatus = 'not_crawled';
    } else if (hitPageLimit || hitTimeout || errors.length > 0) {
      // Mark as partial if safety limits exceeded or errors occurred
      crawlStatus = 'partial';
    }

    // If safety limits exceeded, add to errors
    if (safetyLimitExceeded && safetyLimitReason) {
      errors.push({ url: websiteUrl, message: safetyLimitReason });
    }
    
    // Generate upgrade hint if depth was limited (but not if safety limits exceeded)
    const upgradeHint = !hitTimeout && visited.size >= maxPages && maxCrawlDepth < 10
      ? userPlan === 'demo'
        ? 'Upgrade to Starter plan for crawl depth up to 3.'
        : userPlan === 'starter'
        ? 'Upgrade to Pro plan for crawl depth up to 10.'
        : undefined
      : hitTimeout
      ? 'Crawl stopped due to safety timeout limit. This crawl will not be retried.'
      : undefined;

    // 5. Store results in database
    const finishedAt = new Date().toISOString();
    
    // Convert integer business_id to UUID format for database
    // Format: 00000000-0000-0000-xxxx-xxxxxxxxxxxx (valid UUID with hex digits)
    // We'll use the business ID as hex in the last 12 digits
    const hexId = businessId.toString(16).padStart(12, '0');
    const businessIdUuid = `00000000-0000-0000-0000-${hexId}`;
    
    const crawlResult: CrawlResultV1 = {
      business_id: businessIdUuid,
      dataset_id: datasetId,
      website_url: normalized,
      started_at: startedAt,
      finished_at: finishedAt,
      pages_visited: visited.size,
      crawl_status: crawlStatus,
      emails: Array.from(allEmails.values()),
      phones: Array.from(allPhones.values()),
      contact_pages: Array.from(contactPages),
      social: socialLinks,
      errors,
    };

    await upsertCrawlResult(crawlResult, businessId);

    // 6. Increment usage counter (only on successful crawl)
    // Works with DB or local JSON
    if (crawlStatus !== 'not_crawled') {
      await incrementUsage(userId, 'crawl');
    }

    // 7. Log crawl action
    logCrawlAction({
      userId,
      datasetId,
      resultSummary: `Crawl ${crawlStatus}: ${visited.size} pages visited, ${allEmails.size} emails, ${allPhones.size} phones found`,
      gated: isGated,
      error: hitTimeout ? safetyLimitReason : errors.length > 0 ? errors[0]?.message : null,
      metadata: {
        business_id: businessId,
        website_url: normalized,
        pages_visited: visited.size,
        pages_limit: maxPages,
        crawl_status: crawlStatus,
        emails_found: allEmails.size,
        phones_found: allPhones.size,
        contact_pages_found: contactPages.size,
        errors_count: errors.length,
        hit_timeout: hitTimeout,
        hit_page_limit: hitPageLimit,
        upgrade_hint: upgradeHint,
      },
    });

    // 8. Return result
    // Note: If safety limits exceeded, status is already 'partial' and should not be retried
    return {
      success: !hitTimeout, // Success is false if timeout exceeded
      business_id: businessId,
      dataset_id: datasetId,
      website_url: normalized,
      pages_visited: visited.size,
      pages_limit: maxPages,
      gated: isGated,
      crawl_status: crawlStatus,
      emails_found: allEmails.size,
      phones_found: allPhones.size,
      contact_pages_found: contactPages.size,
      upgrade_hint: upgradeHint,
    };
  } catch (error: any) {
    console.error('[crawlWorkerV1] Error:', error);
    
    // Log error action
    logCrawlAction({
      userId,
      datasetId,
      resultSummary: `Crawl failed: ${error.message || 'Unknown error'}`,
      gated: false,
      error: error.message || 'Crawl failed',
      metadata: {
        business_id: businessId,
        website_url: websiteUrl,
        error_type: error.name || 'Error',
      },
    });

    return {
      success: false,
      business_id: businessId,
      dataset_id: datasetId,
      website_url: websiteUrl,
      pages_visited: 0,
      pages_limit: 0,
      gated: false,
      crawl_status: 'not_crawled',
      emails_found: 0,
      phones_found: 0,
      contact_pages_found: 0,
      error: error.message || 'Crawl failed',
    };
  } finally {
    // Always release crawl slot (hard limit: MAX_CONCURRENT_CRAWLS = 1)
    if (releaseCrawlSlot) {
      releaseCrawlSlot();
    }
  }
}

/**
 * Upsert crawl result to database
 * Uses ON CONFLICT to update existing results
 */
async function upsertCrawlResult(result: CrawlResultV1, businessIdInt: number): Promise<void> {
  // Convert integer business_id to UUID format for database
  const businessIdUuid = result.business_id;

  await pool.query(
    `
    INSERT INTO crawl_results (
      business_id,
      dataset_id,
      website_url,
      started_at,
      finished_at,
      pages_visited,
      crawl_status,
      emails,
      phones,
      contact_pages,
      social,
      errors,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
    ON CONFLICT (business_id, dataset_id)
    DO UPDATE SET
      website_url = EXCLUDED.website_url,
      started_at = EXCLUDED.started_at,
      finished_at = EXCLUDED.finished_at,
      pages_visited = EXCLUDED.pages_visited,
      crawl_status = EXCLUDED.crawl_status,
      emails = EXCLUDED.emails,
      phones = EXCLUDED.phones,
      contact_pages = EXCLUDED.contact_pages,
      social = EXCLUDED.social,
      errors = EXCLUDED.errors,
      updated_at = NOW()
    `,
    [
      businessIdUuid,
      result.dataset_id,
      result.website_url,
      result.started_at,
      result.finished_at,
      result.pages_visited,
      result.crawl_status,
      JSON.stringify(result.emails),
      JSON.stringify(result.phones),
      result.contact_pages,
      JSON.stringify(result.social),
      JSON.stringify(result.errors),
    ]
  );
}
