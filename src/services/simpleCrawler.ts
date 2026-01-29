import { chromium, Browser, Page } from 'playwright';
import axios from 'axios';
import robotsParser from 'robots-parser';
import fs from 'fs/promises';
import path from 'path';

export type CrawlStatus = 'ok' | 'blocked' | 'error';

export interface ContactRecord {
  value: string;
  sourceUrl: string;
  detectedAt: string;
}

export interface SocialRecord {
  platform: 'facebook' | 'instagram' | 'linkedin' | 'unknown';
  url: string;
  sourceUrl: string;
}

export interface CrawlContacts {
  emails: ContactRecord[];
  phones: ContactRecord[];
  socials: SocialRecord[];
}

export interface CrawlResultPayload {
  websiteUrl: string;
  status: CrawlStatus;
  pagesVisited: string[];
  contacts: CrawlContacts;
  errorMessage?: string;
}

export interface CrawlOptions {
  timeoutMs?: number;
  pageTimeoutMs?: number;
  userAgent?: string;
  maxContactPages?: number;
  writeToFile?: boolean;
  outputPath?: string;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; LeadsCrawler/1.0; +https://example.com)';

async function fetchRobotsTxt(
  websiteUrl: string,
  userAgent: string
): Promise<{ allowed: boolean; reason?: string }> {
  let url: URL;
  try {
    url = new URL(websiteUrl);
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }

  const robotsUrl = `${url.origin}/robots.txt`;

  try {
    const response = await axios.get<string>(robotsUrl, {
      timeout: 8000,
      validateStatus: status => status >= 200 && status < 500
    });

    if (response.status >= 400) {
      // No robots.txt or not accessible – default to allowed
      return { allowed: true };
    }

    const robots = robotsParser(robotsUrl, response.data);
    const isAllowed = robots.isAllowed(websiteUrl, userAgent);

    return {
      allowed: isAllowed ?? true,
      reason: isAllowed ? undefined : 'Disallowed by robots.txt'
    };
  } catch {
    // Network error – be conservative but not overly strict: allow crawl
    return { allowed: true };
  }
}

function extractEmails(html: string, pageUrl: string, emails: Map<string, ContactRecord>): void {
  const detectedAt = new Date().toISOString();

  // From mailto links
  const mailtoRegex = /href=["']mailto:([^"'?]+)[^"']*["']/gi;
  let match: RegExpExecArray | null;
  while ((match = mailtoRegex.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    const value = raw.toLowerCase();
    if (!emails.has(value)) {
      emails.set(value, { value, sourceUrl: pageUrl, detectedAt });
    }
  }

  // From plain text
  const emailRegex =
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  while ((match = emailRegex.exec(html)) !== null) {
    const value = match[0].toLowerCase();
    if (!emails.has(value)) {
      emails.set(value, { value, sourceUrl: pageUrl, detectedAt });
    }
  }
}

function extractPhones(html: string, pageUrl: string, phones: Map<string, ContactRecord>): void {
  const detectedAt = new Date().toISOString();

  // Broad international / Greek-ish phone regex
  const phoneRegex =
    /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}/g;

  let match: RegExpExecArray | null;
  while ((match = phoneRegex.exec(html)) !== null) {
    let value = match[0].trim();

    // Filter out obviously wrong short sequences
    const digits = value.replace(/\D/g, '');
    if (digits.length < 7) {
      continue;
    }

    // Normalize basic spacing
    value = value.replace(/\s+/g, ' ');

    if (!phones.has(value)) {
      phones.set(value, { value, sourceUrl: pageUrl, detectedAt });
    }
  }
}

function extractSocials(html: string, pageUrl: string, socials: Map<string, SocialRecord>): void {
  const linkRegex = /href=["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1].trim();
    if (!href) continue;

    let platform: SocialRecord['platform'] | null = null;
    const lower = href.toLowerCase();

    if (lower.includes('facebook.com')) platform = 'facebook';
    else if (lower.includes('instagram.com')) platform = 'instagram';
    else if (lower.includes('linkedin.com')) platform = 'linkedin';

    if (!platform) continue;

    const key = `${platform}|${href}`;
    if (!socials.has(key)) {
      socials.set(key, { platform, url: href, sourceUrl: pageUrl });
    }
  }
}

async function collectInternalLinks(page: Page, origin: string): Promise<string[]> {
  const hrefs = await page.$$eval('a[href]', elements =>
    elements
      .map(el => {
        const anyEl = el as { getAttribute(name: string): string | null };
        const href = anyEl.getAttribute('href');
        return href ?? '';
      })
      .filter(Boolean)
  );

  const internal = new Set<string>();

  for (const href of hrefs) {
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      continue;
    }

    let absolute: string;
    try {
      absolute = new URL(href, origin).toString();
    } catch {
      continue;
    }

    if (!absolute.startsWith(origin)) continue;
    internal.add(absolute);
  }

  return Array.from(internal);
}

function scoreContactUrl(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;

  if (lower.endsWith('/contact') || lower.includes('/contact')) score += 3;
  if (lower.includes('επικοινων')) score += 3; // Greek for contact
  if (lower.includes('/about')) score += 2;
  if (lower.includes('/company')) score += 2;
  if (lower.includes('contact-')) score += 2;
  if (lower.includes('support')) score += 1;

  return score;
}

export async function crawlWebsiteForContacts(
  websiteUrl: string,
  options: CrawlOptions = {}
): Promise<CrawlResultPayload> {
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? 60000;
  const pageTimeoutMs = options.pageTimeoutMs ?? 20000;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const maxContactPages = options.maxContactPages ?? 2;

  const result: CrawlResultPayload = {
    websiteUrl,
    status: 'ok',
    pagesVisited: [],
    contacts: {
      emails: [],
      phones: [],
      socials: []
    }
  };

  let browser: Browser | null = null;

  try {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    // Check robots.txt
    const robots = await fetchRobotsTxt(websiteUrl, userAgent);
    if (!robots.allowed) {
      clearTimeout(timeoutHandle);
      result.status = 'blocked';
      result.errorMessage = robots.reason ?? 'Blocked by robots.txt';
      return result;
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent });
    const page = await context.newPage();

    // Visit homepage
    await page.goto(websiteUrl, {
      timeout: pageTimeoutMs,
      waitUntil: 'domcontentloaded'
    });
    result.pagesVisited.push(websiteUrl);

    const origin = new URL(websiteUrl).origin;
    const internalLinks = await collectInternalLinks(page, origin);

    // Rank likely contact pages
    const scored = internalLinks
      .map(url => ({ url, score: scoreContactUrl(url) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxContactPages);

    const pagesToVisit: string[] = [websiteUrl];
    for (const item of scored) {
      if (!pagesToVisit.includes(item.url)) {
        pagesToVisit.push(item.url);
      }
    }

    const emailMap = new Map<string, ContactRecord>();
    const phoneMap = new Map<string, ContactRecord>();
    const socialMap = new Map<string, SocialRecord>();

    for (const url of pagesToVisit) {
      // Global timeout check
      if (Date.now() - startTime > timeoutMs) {
        break;
      }

      if (url !== websiteUrl) {
        try {
          await page.goto(url, {
            timeout: pageTimeoutMs,
            waitUntil: 'domcontentloaded'
          });
          result.pagesVisited.push(url);
        } catch {
          // Skip failed page but continue others
          continue;
        }
      }

      const html = await page.content();
      extractEmails(html, url, emailMap);
      extractPhones(html, url, phoneMap);
      extractSocials(html, url, socialMap);
    }

    result.contacts.emails = Array.from(emailMap.values());
    result.contacts.phones = Array.from(phoneMap.values());
    result.contacts.socials = Array.from(socialMap.values());

    clearTimeout(timeoutHandle);

    if (options.writeToFile) {
      const outPath =
        options.outputPath ??
        path.join(
          process.cwd(),
          `crawl-result-${new URL(websiteUrl).hostname}.json`
        );
      await fs.writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');
    }

    return result;
  } catch (error) {
    result.status = 'error';
    result.errorMessage =
      error instanceof Error ? error.message : String(error);
    return result;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

