import { chromium, type Browser, type Page } from 'playwright';
import * as cheerio from 'cheerio';
import RobotsParser from 'robots-parser';
import axios from 'axios';
import type { Website, CrawlJob } from '../types/index.js';
import type { CrawlResult } from '../types/index.js';
import { updateWebsiteCrawlData } from '../db/websites.js';
import { updateCrawlJob } from '../db/crawlJobs.js';
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
      const baseUrlObj = new URL(website.url);
      
      // Always crawl homepage first (includes header and footer)
      urlsToCrawl.push({ url: website.url, pageType: 'homepage' });
      
      // Expanded contact page patterns (Greek and English)
      const contactPaths = [
        '/contact',
        '/contacts',
        '/contact-us',
        '/contactus',
        '/επικοινωνια',
        '/επικοινωνία',
        '/επικοινωνηστε-μαζι-μα',
        '/επικοινωνήστε-μαζί-μας',
        '/epikoinonia',
        '/epikoinonia-mas',
        '/about',
        '/company',
        '/about-us',
        '/σχετικα-μας',
        '/σχετικά-μας'
      ];
      
      for (const path of contactPaths) {
        try {
          const url = new URL(path, baseUrl).toString();
          // Determine page type based on path
          let pageType: CrawlResult['pageType'] = 'contact';
          if (path.includes('about') || path.includes('σχετικ')) {
            pageType = 'about';
          } else if (path.includes('company') || path.includes('εταιρ')) {
            pageType = 'company';
          }
          urlsToCrawl.push({ url, pageType });
        } catch {
          // Invalid URL, skip
        }
      }
      
      // Also try to find contact pages by crawling homepage and extracting links
      // This will be done after homepage is crawled (see footer link extraction below)

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

        // If this is the homepage, extract footer links AND find contact-related links
        if (pageType === 'homepage') {
          const footerLinks = extractFooterLinks(html, website.url);
          for (const link of footerLinks) {
            if (!crawledUrls.has(link) && results.length < CRAWLER_MAX_PAGES) {
              urlsToCrawl.push({ url: link, pageType: 'footer' });
            }
          }
          
          // Also extract contact-related links from navigation and body
          const contactLinkPatterns = [
            /contact/i,
            /επικοινων/i,
            /epikoinonia/i
          ];
          
          // Load HTML with cheerio to extract links
          const $ = cheerio.load(html);
          $('a[href]').each((_, element) => {
            const href = $(element).attr('href');
            if (!href) return;
            
            try {
              const absoluteUrl = new URL(href, baseUrl).toString();
              if (new URL(absoluteUrl).hostname !== baseUrlObj.hostname) return;
              
              const linkText = $(element).text().toLowerCase();
              const hrefLower = href.toLowerCase();
              
              // Check if link text or href contains contact-related keywords
              const isContactLink = contactLinkPatterns.some(pattern => 
                pattern.test(linkText) || pattern.test(hrefLower)
              );
              
              if (isContactLink && !crawledUrls.has(absoluteUrl) && results.length < CRAWLER_MAX_PAGES) {
                urlsToCrawl.push({ url: absoluteUrl, pageType: 'contact' });
              }
            } catch {
              // Invalid URL, skip
            }
          });
        }
      }

      if (page) await page.close();
      if (context) await context.close();

      // Store crawl results in database (crawl_pages only; crawl_results is legacy)
      for (const crawlResult of results) {
        // Store in crawl_pages (used by extraction worker)
        try {
          const { createCrawlPage } = await import('../db/crawlPages.js');
          await createCrawlPage({
            crawl_job_id: crawlJob.id,
            url: crawlResult.url,
            final_url: crawlResult.url,
            status_code: 200,
            content_type: 'text/html',
            html: crawlResult.html,
            hash: crawlResult.htmlHash,
            fetched_at: new Date()
          });
        } catch (error: any) {
          // If page already exists, skip (might be duplicate)
          if (error.code !== '23505') {
            console.error(`[crawlWebsite] Error storing page in crawl_pages:`, error.message);
          }
        }
      }

      // Update website with last crawl data (use homepage hash if available)
      const homepageResult = results.find(r => r.pageType === 'homepage');
      if (homepageResult) {
        await updateWebsiteCrawlData(website.id, homepageResult.htmlHash);
      }

      // Update job status - mark as completed even if we got some results
      // Partial success is better than complete failure
      if (results.length > 0) {
        console.log(`[crawlWebsite] Crawl completed with ${results.length} pages (some pages may have failed)`);
        await updateCrawlJob(crawlJob.id, {
          status: 'completed',
          pages_crawled: results.length,
          completed_at: new Date()
        });
      } else {
        // No pages crawled - this is a complete failure
        throw new Error('No pages were successfully crawled');
      }

    } catch (error) {
      if (page) await page.close();
      if (context) await context.close();
      
      // If we have some results, don't fail completely - mark as completed with partial results
      if (results.length > 0) {
        console.warn(`[crawlWebsite] Crawl encountered errors but got ${results.length} pages - marking as completed with partial results`);
        await updateCrawlJob(crawlJob.id, {
          status: 'completed',
          pages_crawled: results.length,
          completed_at: new Date(),
          error_message: error instanceof Error ? error.message : String(error)
        });
        return results; // Return partial results instead of throwing
      }
      
      // No results at all - re-throw to mark as failed
      throw error;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[crawlWebsite] Crawl failed completely for website ${website.url}:`, errorMessage);
    await updateCrawlJob(crawlJob.id, {
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date()
    });
    // Don't throw - let the crawl worker continue with next job
    // Return empty results so extraction worker can fallback to Place Details
    return [];
  }

  return results;
}
