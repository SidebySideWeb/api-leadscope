/**
 * Enrichment Service
 * Scrapes websites for missing email/phone contacts
 * Uses Playwright or Cheerio for web scraping
 */

import { chromium, Browser, Page } from 'playwright';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { pool } from '../config/database.js';

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ headless: true });
  }
  return browserInstance;
}

/**
 * Extract email addresses from HTML content
 */
function extractEmails(html: string): string[] {
  const emails: string[] = [];
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = html.match(emailRegex);
  if (matches) {
    emails.push(...matches);
  }
  return [...new Set(emails)]; // Remove duplicates
}

/**
 * Extract phone numbers from HTML content
 */
function extractPhones(html: string): string[] {
  const phones: string[] = [];
  // Greek phone patterns
  const phoneRegex = /(?:\+30|0030)?[\s-]?(?:69|21|22|23|24|25|26|27|28|29)[\s-]?\d{3}[\s-]?\d{4}/g;
  const matches = html.match(phoneRegex);
  if (matches) {
    phones.push(...matches.map(p => p.replace(/\s+/g, '')));
  }
  return [...new Set(phones)]; // Remove duplicates
}

/**
 * Scrape website using Cheerio (lightweight, fast)
 */
async function scrapeWithCheerio(url: string): Promise<{ emails: string[]; phones: string[] }> {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      validateStatus: (status) => status < 500,
    });

    if (response.status !== 200) {
      return { emails: [], phones: [] };
    }

    const html = response.data;
    const emails = extractEmails(html);
    const phones = extractPhones(html);

    return { emails, phones };
  } catch (error) {
    console.error(`[Enrichment] Error scraping ${url} with Cheerio:`, error);
    return { emails: [], phones: [] };
  }
}

/**
 * Scrape website using Playwright (for JavaScript-heavy sites)
 */
async function scrapeWithPlaywright(url: string): Promise<{ emails: string[]; phones: string[] }> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const html = await page.content();
    
    const emails = extractEmails(html);
    const phones = extractPhones(html);

    return { emails, phones };
  } catch (error) {
    console.error(`[Enrichment] Error scraping ${url} with Playwright:`, error);
    return { emails: [], phones: [] };
  } finally {
    await page.close();
    await context.close();
  }
}

/**
 * Enrich a business by scraping its website for missing contacts
 */
export async function enrichBusiness(businessId: string): Promise<{
  emailsFound: number;
  phonesFound: number;
  success: boolean;
}> {
  try {
    // Get business website
    const businessResult = await pool.query<{
      website_url: string | null;
      name: string;
    }>(
      `SELECT b.website_url, b.name
       FROM businesses b
       WHERE b.id = $1`,
      [businessId]
    );

    if (businessResult.rows.length === 0) {
      return { emailsFound: 0, phonesFound: 0, success: false };
    }

    const business = businessResult.rows[0];
    const websiteUrl = business.website_url;

    if (!websiteUrl) {
      console.log(`[Enrichment] Business ${businessId} has no website_url`);
      return { emailsFound: 0, phonesFound: 0, success: false };
    }

    // Check if business already has email or phone
    const existingContactsResult = await pool.query<{
      has_email: boolean;
      has_phone: boolean;
    }>(
      `SELECT 
         EXISTS(SELECT 1 FROM contacts c 
                JOIN contact_sources cs ON cs.contact_id = c.id 
                WHERE cs.business_id = $1 AND c.email IS NOT NULL) as has_email,
         EXISTS(SELECT 1 FROM contacts c 
                JOIN contact_sources cs ON cs.contact_id = c.id 
                WHERE cs.business_id = $1 AND (c.phone IS NOT NULL OR c.mobile IS NOT NULL)) as has_phone`,
      [businessId]
    );

    const hasEmail = existingContactsResult.rows[0]?.has_email || false;
    const hasPhone = existingContactsResult.rows[0]?.has_phone || false;

    // Skip if already has both
    if (hasEmail && hasPhone) {
      console.log(`[Enrichment] Business ${businessId} already has email and phone`);
      return { emailsFound: 0, phonesFound: 0, success: true };
    }

    // Normalize URL
    let url = websiteUrl;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    console.log(`[Enrichment] Scraping ${url} for business ${businessId}`);

    // Try Cheerio first (faster), fallback to Playwright if needed
    let result = await scrapeWithCheerio(url);

    // If no results and site might be JS-heavy, try Playwright
    if (result.emails.length === 0 && result.phones.length === 0) {
      console.log(`[Enrichment] No results with Cheerio, trying Playwright for ${url}`);
      result = await scrapeWithPlaywright(url);
    }

    // Save found contacts
    let emailsFound = 0;
    let phonesFound = 0;

    for (const email of result.emails) {
      if (hasEmail) continue; // Skip if already has email

      try {
        const contactResult = await pool.query(
          `INSERT INTO contacts (email, contact_type, created_at)
           VALUES ($1, 'email', NOW())
           ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
           RETURNING id`,
          [email]
        );

        if (contactResult.rows.length > 0) {
          await pool.query(
            `INSERT INTO contact_sources (business_id, contact_id, source_url, page_type, found_at)
             VALUES ($1, $2, $3, 'website_scrape', NOW())
             ON CONFLICT DO NOTHING`,
            [businessId, contactResult.rows[0].id, url]
          );
          emailsFound++;
        }
      } catch (error) {
        console.error(`[Enrichment] Error saving email ${email}:`, error);
      }
    }

    for (const phone of result.phones) {
      if (hasPhone) continue; // Skip if already has phone

      try {
        const contactResult = await pool.query(
          `INSERT INTO contacts (phone, contact_type, created_at)
           VALUES ($1, 'phone', NOW())
           ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
           RETURNING id`,
          [phone]
        );

        if (contactResult.rows.length > 0) {
          await pool.query(
            `INSERT INTO contact_sources (business_id, contact_id, source_url, page_type, found_at)
             VALUES ($1, $2, $3, 'website_scrape', NOW())
             ON CONFLICT DO NOTHING`,
            [businessId, contactResult.rows[0].id, url]
          );
          phonesFound++;
        }
      } catch (error) {
        console.error(`[Enrichment] Error saving phone ${phone}:`, error);
      }
    }

    console.log(`[Enrichment] Enriched business ${businessId}: ${emailsFound} emails, ${phonesFound} phones`);

    return { emailsFound, phonesFound, success: true };
  } catch (error: any) {
    console.error(`[Enrichment] Error enriching business ${businessId}:`, error);
    return { emailsFound: 0, phonesFound: 0, success: false };
  }
}

/**
 * Enrich businesses that are missing email or phone
 * Processes in batches
 */
export async function enrichMissingContacts(batchSize: number = 10): Promise<{
  processed: number;
  emailsFound: number;
  phonesFound: number;
}> {
  // Find businesses missing email or phone
  const businessesResult = await pool.query<{ id: string; website_url: string }>(
    `SELECT DISTINCT b.id, b.website_url
     FROM businesses b
     WHERE b.website_url IS NOT NULL
       AND (
         NOT EXISTS (
           SELECT 1 FROM contacts c
           JOIN contact_sources cs ON cs.contact_id = c.id
           WHERE cs.business_id = b.id AND c.email IS NOT NULL
         )
         OR NOT EXISTS (
           SELECT 1 FROM contacts c
           JOIN contact_sources cs ON cs.contact_id = c.id
           WHERE cs.business_id = b.id AND (c.phone IS NOT NULL OR c.mobile IS NOT NULL)
         )
       )
     LIMIT $1`,
    [batchSize]
  );

  let totalEmailsFound = 0;
  let totalPhonesFound = 0;

  for (const business of businessesResult.rows) {
    const result = await enrichBusiness(business.id);
    totalEmailsFound += result.emailsFound;
    totalPhonesFound += result.phonesFound;

    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return {
    processed: businessesResult.rows.length,
    emailsFound: totalEmailsFound,
    phonesFound: totalPhonesFound,
  };
}

/**
 * Close browser instance (call on shutdown)
 */
export async function closeEnrichmentBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
