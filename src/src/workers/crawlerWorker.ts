import { chromium, type Browser, type Page } from 'playwright';
import * as cheerio from 'cheerio';
import RobotsParser from 'robots-parser';
import axios from 'axios';
import type { Website, CrawlJob } from '../types/index.js';
import type { CrawlResult } from '../types/index.js';
import { updateWebsiteCrawlData } from '../db/websites.js';
import { updateCrawlJob } from '../db/crawlJobs.js';
import { createCrawlResult } from '../db/crawlResults.js';
import { hashHtml } from '../utils/htmlHasher.js';
import dotenv from 'dotenv';

dotenv.config();

const CRAWLER_TIMEOUT = parseInt(process.env.CRAWLER_TIMEOUT || '20000', 10);
const CRAWLER_MAX_PAGES = parseInt(process.env.CRAWLER_MAX_PAGES || '10', 10);
const USER_AGENT = process.env.CRAWLER_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

async function checkRobotsTxt(url: string): Promise<boolean> {
  try {
    const urlObj = new URL(url);
    const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
    
    const response = await axios.get(robotsUrl, {
      timeout: 5000,
      headers: { 'User-Agent': USER_AGENT }
    });

    const robots = RobotsParser(robotsUrl, response.data);
    return robots.isAllowed(url, USER_AGENT) ?? true;
  } catch (error) {
    // If robots.txt doesn't exist or can't be fetched, assume allowed
    return true;
  }
}

async function crawlPage(url: string, page: Page): Promise<string | null> {
  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: CRAWLER_TIMEOUT
    });

    return await page.content();
  } catch (error) {
    console.error(`Error crawling ${url}:`, error);
    return null;
  }
}

function extractFooterLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  const baseUrlObj = new URL(baseUrl);

  $('footer a, .footer a').each((_, element) => {
    const href = $(element).attr('href');
    if (href) {
      try {
        const absoluteUrl = new URL(href, baseUrl).toString();
        if (new URL(absoluteUrl).hostname === baseUrlObj.hostname) {
          links.push(absoluteUrl);
        }
      } catch {
        // Invalid URL, skip
      }
    }
  });

  return links;
}

export async function crawlWebsite(website: Website, crawlJob: CrawlJob): Promise<CrawlResult[]> {
  const results: CrawlResult[] = [];
  const crawledUrls = new Set<string>();
  const urlsToCrawl: Array<{ url: string; pageType: CrawlResult['pageType'] }> = [];

  // Update job status
  await updateCrawlJob(crawlJob.id, {
    status: 'running',
    started_at: new Date()
  });

  let context: any = null;
  let page: Page | null = null;

  try {
    // Check robots.txt
    const allowed = await checkRobotsTxt(website.url);
    if (!allowed) {
      throw new Error('Crawling disallowed by robots.txt');
    }

    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: USER_AGENT
    });
    page = await context.newPage();

    try {
      // Add initial pages to crawl
      const baseUrl = new URL(website.url);
      urlsToCrawl.push({ url: website.url, pageType: 'homepage' });
      
      const paths = ['/contact', '/about', '/company'];
      for (const path of paths) {
        try {
          const url = new URL(path, baseUrl).toString();
          urlsToCrawl.push({ url, pageType: path.substring(1) as CrawlResult['pageType'] });
        } catch {
          // Invalid URL, skip
        }
      }

      // Crawl pages
      while (urlsToCrawl.length > 0 && results.length < CRAWLER_MAX_PAGES) {
        const { url, pageType } = urlsToCrawl.shift()!;

        if (crawledUrls.has(url)) continue;
        crawledUrls.add(url);

        const html = await crawlPage(url, page!);
        if (!html) continue;

        const htmlHash = hashHtml(html);
        results.push({
          url,
          html,
          htmlHash,
          pageType
        });

        // If this is the homepage, extract footer links
        if (pageType === 'homepage') {
          const footerLinks = extractFooterLinks(html, website.url);
          for (const link of footerLinks) {
            if (!crawledUrls.has(link) && results.length < CRAWLER_MAX_PAGES) {
              urlsToCrawl.push({ url: link, pageType: 'footer' });
            }
          }
        }
      }

      if (page) await page.close();
      if (context) await context.close();

      // Store crawl results in database
      for (const crawlResult of results) {
        await createCrawlResult({
          crawl_job_id: crawlJob.id,
          url: crawlResult.url,
          html: crawlResult.html,
          html_hash: crawlResult.htmlHash,
          page_type: crawlResult.pageType
        });
      }

      // Update website with last crawl data (use homepage hash if available)
      const homepageResult = results.find(r => r.pageType === 'homepage');
      if (homepageResult) {
        await updateWebsiteCrawlData(website.id, homepageResult.htmlHash);
      }

      // Update job status
      await updateCrawlJob(crawlJob.id, {
        status: 'completed',
        pages_crawled: results.length,
        completed_at: new Date()
      });

    } catch (error) {
      if (page) await page.close();
      if (context) await context.close();
      throw error;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateCrawlJob(crawlJob.id, {
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date()
    });
    throw error;
  }

  return results;
}
