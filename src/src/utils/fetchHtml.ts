import { chromium, type Browser } from 'playwright';
import axios from 'axios';
import robotsParser from 'robots-parser';
import { hashHtml } from './htmlHasher.js';

export interface FetchHtmlResult {
  url: string;
  finalUrl: string;
  statusCode: number | null;
  contentType: string | null;
  html: string;
  hash: string;
}

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ headless: true });
  }
  return browserInstance;
}

export async function closeCrawlerBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export async function isAllowedByRobots(
  websiteUrl: string,
  userAgent: string
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(websiteUrl);
  } catch {
    return false;
  }

  const robotsUrl = `${url.origin}/robots.txt`;

  try {
    const response = await axios.get<string>(robotsUrl, {
      timeout: 5000,
      validateStatus: status => status >= 200 && status < 500
    });

    if (response.status >= 400) {
      // No robots.txt or not accessible – default to allowed
      return true;
    }

    const robots = robotsParser(robotsUrl, response.data);
    const allowed = robots.isAllowed(websiteUrl, userAgent);
    return allowed ?? true;
  } catch {
    // Network errors: be permissive
    return true;
  }
}

export async function fetchHtmlWithPlaywright(
  url: string,
  userAgent: string,
  timeoutMs: number
): Promise<FetchHtmlResult | null> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent });
  const page = await context.newPage();

  try {
    const response = await page.goto(url, {
      timeout: timeoutMs,
      waitUntil: 'domcontentloaded'
    });

    const html = await page.content();
    const finalUrl = page.url();
    const statusCode = response ? response.status() : null;
    const headers = response ? response.headers() : {};
    const contentType =
      typeof headers['content-type'] === 'string'
        ? headers['content-type']
        : null;

    const hash = hashHtml(html);

    return {
      url,
      finalUrl,
      statusCode,
      contentType,
      html,
      hash
    };
  } catch (error) {
    console.error(`Error fetching HTML for ${url}:`, error);
    return null;
  } finally {
    await page.close();
    await context.close();
  }
}

