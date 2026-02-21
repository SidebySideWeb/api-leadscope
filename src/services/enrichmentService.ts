/**
 * Enrichment Service
 * Scrapes websites for missing email/phone contacts
 * Uses Playwright or Cheerio for web scraping
 */

import { chromium, Browser, Page } from 'playwright';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { pool } from '../config/database.js';
import { crawlFacebookContactInfo, crawlLinkedInAbout } from '../crawl/socialMediaCrawler.js';

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ headless: true });
  }
  return browserInstance;
}

/**
 * Extract email addresses from HTML content
 * Includes mailto: links and regex pattern matching
 */
function extractEmails(html: string): string[] {
  const emails: string[] = [];
  
  // 1. Extract from mailto: links
  const mailtoRegex = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  let mailtoMatch;
  while ((mailtoMatch = mailtoRegex.exec(html)) !== null) {
    emails.push(mailtoMatch[1]);
  }
  
  // 2. Extract from regex pattern (general email pattern)
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = html.match(emailRegex);
  if (matches) {
    emails.push(...matches);
  }
  
  // Filter out common non-business emails
  const filtered = emails.filter(email => {
    const lower = email.toLowerCase();
    return !lower.includes('example.com') &&
           !lower.includes('test.com') &&
           !lower.includes('sample.com') &&
           !lower.includes('placeholder') &&
           !lower.includes('noreply') &&
           !lower.includes('no-reply') &&
           !lower.includes('donotreply');
  });
  
  return [...new Set(filtered)]; // Remove duplicates
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
 * Crawl multiple pages from a website to find email
 * Tries common contact pages: /contact, /about, /επικοινωνία
 */
async function crawlContactPages(baseUrl: string): Promise<{ emails: string[]; phones: string[] }> {
  const allEmails: string[] = [];
  const allPhones: string[] = [];
  
  // Common contact page paths (including Greek)
  const contactPaths = [
    '/contact',
    '/about',
    '/επικοινωνία',
    '/contact-us',
    '/about-us',
    '/get-in-touch',
    '/reach-us'
  ];
  
  // Normalize base URL
  const urlObj = new URL(baseUrl);
  const base = `${urlObj.protocol}//${urlObj.host}`;
  
  for (const path of contactPaths) {
    try {
      const contactUrl = `${base}${path}`;
      console.log(`[Enrichment] Trying contact page: ${contactUrl}`);
      
      const result = await scrapeWithCheerio(contactUrl);
      
      if (result.emails.length > 0 || result.phones.length > 0) {
        allEmails.push(...result.emails);
        allPhones.push(...result.phones);
        console.log(`[Enrichment] Found ${result.emails.length} emails, ${result.phones.length} phones on ${contactUrl}`);
        // If we found emails, we can stop (optional - could continue to find more)
        if (result.emails.length > 0) {
          break; // Found email, no need to check other pages
        }
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      // Continue to next page if this one fails
      continue;
    }
  }
  
  return {
    emails: [...new Set(allEmails)],
    phones: [...new Set(allPhones)]
  };
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

    // Check if business already has email or phone directly on businesses table
    const existingContactsResult = await pool.query<{
      email: string | null;
      phone: string | null;
    }>(
      `SELECT email, phone FROM businesses WHERE id = $1`,
      [businessId]
    );

    const hasEmail = !!existingContactsResult.rows[0]?.email;
    const hasPhone = !!existingContactsResult.rows[0]?.phone;

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

    console.log(`[Enrichment] Starting comprehensive email search for ${url} (business ${businessId})`);

    let allEmails: string[] = [];
    let allPhones: string[] = [];

    // Step 1: Fetch homepage and search for mailto: and regex emails
    console.log(`[Enrichment] Step 1: Fetching homepage ${url}`);
    let result = await scrapeWithCheerio(url);

    // If no results and site might be JS-heavy, try Playwright
    if (result.emails.length === 0 && result.phones.length === 0) {
      console.log(`[Enrichment] No results with Cheerio, trying Playwright for ${url}`);
      result = await scrapeWithPlaywright(url);
    }

    allEmails.push(...result.emails);
    allPhones.push(...result.phones);
    console.log(`[Enrichment] Homepage: Found ${result.emails.length} emails, ${result.phones.length} phones`);

    // Step 2: If no email found, crawl contact pages
    if (result.emails.length === 0 && !hasEmail) {
      console.log(`[Enrichment] Step 2: No email on homepage, crawling contact pages...`);
      const contactResult = await crawlContactPages(url);
      allEmails.push(...contactResult.emails);
      allPhones.push(...contactResult.phones);
      console.log(`[Enrichment] Contact pages: Found ${contactResult.emails.length} emails, ${contactResult.phones.length} phones`);
    }

    // Step 3: Optional deep crawl (if still no email found)
    // This could crawl more pages, but for now we'll skip to avoid being too aggressive
    // Can be enabled later if needed

    // Remove duplicates
    const uniqueEmails = [...new Set(allEmails)];
    const uniquePhones = [...new Set(allPhones)];

    result = {
      emails: uniqueEmails,
      phones: uniquePhones
    };

    // Save found contacts directly to businesses table
    let emailsFound = 0;
    let phonesFound = 0;
    let emailToSave: string | null = null;
    let phoneToSave: string | null = null;

    // Get first email if business doesn't have one
    if (!hasEmail && result.emails.length > 0) {
      emailToSave = result.emails[0]; // Use first email found
      emailsFound = 1;
    }

    // Get first phone if business doesn't have one
    if (!hasPhone && result.phones.length > 0) {
      phoneToSave = result.phones[0]; // Use first phone found
      phonesFound = 1;
    }

    // Update businesses table with found contacts
    if (emailToSave || phoneToSave) {
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (emailToSave) {
        updateFields.push(`email = $${paramIndex}`);
        updateValues.push(emailToSave);
        paramIndex++;
      }

      if (phoneToSave) {
        updateFields.push(`phone = $${paramIndex}`);
        updateValues.push(phoneToSave);
        paramIndex++;
      }

      if (updateFields.length > 0) {
        updateValues.push(businessId);
        await pool.query(
          `UPDATE businesses 
           SET ${updateFields.join(', ')}, updated_at = NOW()
           WHERE id = $${paramIndex}`,
          updateValues
        );
        console.log(`[Enrichment] Updated business ${businessId}: email=${emailToSave || 'none'}, phone=${phoneToSave || 'none'}`);
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

// Google search removed - email enrichment now only uses website, Facebook, and LinkedIn crawling

/**
 * Enrich business with email using fallback chain:
 * 1. Check if email already exists
 * 2. Crawl website if exists (homepage + contact pages)
 * 3. Crawl Facebook page if exists
 * 4. Crawl LinkedIn page if exists
 */
export async function enrichBusinessEmail(businessId: string): Promise<{
  emailFound: boolean;
  source: 'existing' | 'website' | 'facebook' | 'linkedin' | 'none';
}> {
  try {
    // Get business info - social media links are not stored in businesses table
    const businessResult = await pool.query<{
      email: string | null;
      website_url: string | null;
      name: string;
      facebook_url: string | null;
      linkedin_url: string | null;
    }>(
      `SELECT 
         b.email, 
         b.website_url, 
         b.name,
         NULL AS facebook_url,
         NULL AS linkedin_url
       FROM businesses b
       WHERE b.id = $1`,
      [businessId]
    );

    if (businessResult.rows.length === 0) {
      return { emailFound: false, source: 'none' };
    }

    const business = businessResult.rows[0];

    // Check if email already exists
    if (business.email) {
      console.log(`[Enrichment] Business ${businessId} already has email: ${business.email}`);
      return { emailFound: true, source: 'existing' };
    }

    let emailFound: string | null = null;
    let source: 'website' | 'facebook' | 'linkedin' | 'none' = 'none';

    // Step 1: Try to find email on website if it exists
    if (business.website_url && !emailFound) {
      console.log(`[Enrichment] Attempting to find email on website for business ${businessId}`);
      const enrichResult = await enrichBusiness(businessId);
      
      if (enrichResult.emailsFound > 0) {
        // Check if email was saved
        const checkResult = await pool.query<{ email: string | null }>(
          `SELECT email FROM businesses WHERE id = $1`,
          [businessId]
        );
        if (checkResult.rows[0]?.email) {
          emailFound = checkResult.rows[0].email;
          source = 'website';
          console.log(`[Enrichment] Found email on website: ${emailFound}`);
        }
      }
    }

    // Step 2 & 3: Facebook and LinkedIn crawling disabled
    // Note: social_media table and social_links column don't exist
    // Social media URLs are not currently stored in businesses table
    // TODO: Re-enable when social_media table is created or social URLs are added to businesses table
    
    // Facebook crawling - disabled
    if (false && !emailFound) {
      const facebookUrl = business.facebook_url;
      if (facebookUrl) {
        console.log(`[Enrichment] Attempting to find email on Facebook page for business ${businessId}`);
        try {
          const fbResult = await crawlFacebookContactInfo(facebookUrl!);
          
          if (fbResult.emails && fbResult.emails.length > 0) {
            const fbEmail = fbResult.emails[0].value; // Extract email value from result object
            // Save email to database
            await pool.query(
              `UPDATE businesses 
               SET email = $1, updated_at = NOW()
               WHERE id = $2`,
              [fbEmail, businessId]
            );
            emailFound = fbEmail;
            source = 'facebook';
            console.log(`[Enrichment] Found email on Facebook: ${emailFound}`);
          }
        } catch (error: any) {
          console.warn(`[Enrichment] Facebook crawl failed for business ${businessId}:`, error.message);
        }
      }
    }

    // LinkedIn crawling - disabled
    if (false && !emailFound) {
      const linkedinUrl = business.linkedin_url;
      if (linkedinUrl) {
        console.log(`[Enrichment] Attempting to find email on LinkedIn page for business ${businessId}`);
        try {
          const liResult = await crawlLinkedInAbout(linkedinUrl!);
          
          if (liResult.emails && liResult.emails.length > 0) {
            const liEmail = liResult.emails[0].value; // Extract email value from result object
            // Save email to database
            await pool.query(
              `UPDATE businesses 
               SET email = $1, updated_at = NOW()
               WHERE id = $2`,
              [liEmail, businessId]
            );
            emailFound = liEmail;
            source = 'linkedin';
            console.log(`[Enrichment] Found email on LinkedIn: ${emailFound}`);
          }
        } catch (error: any) {
          console.warn(`[Enrichment] LinkedIn crawl failed for business ${businessId}:`, error.message);
        }
      }
    }

    // Note: Google search removed - only website, Facebook, and LinkedIn crawling

    return {
      emailFound: !!emailFound,
      source: emailFound ? source : 'none'
    };
  } catch (error: any) {
    console.error(`[Enrichment] Error enriching email for business ${businessId}:`, error);
    return { emailFound: false, source: 'none' };
  }
}

/**
 * Enrich businesses in a dataset that are missing email
 * Processes in batches to avoid overwhelming the system
 */
export async function enrichDatasetEmails(
  datasetId: string,
  batchSize: number = 10,
  maxBatches: number = 10
): Promise<{
  processed: number;
  emailsFound: number;
  sources: { website: number; facebook: number; linkedin: number; existing: number };
}> {
  console.log(`[Enrichment] Starting email enrichment for dataset ${datasetId}`);
  
  let totalProcessed = 0;
  let totalEmailsFound = 0;
  const sources = { website: 0, facebook: 0, linkedin: 0, existing: 0 };

  for (let batch = 0; batch < maxBatches; batch++) {
    // Find businesses in dataset missing email
    const businessesResult = await pool.query<{ id: string }>(
      `SELECT b.id
       FROM businesses b
       WHERE b.dataset_id = $1
         AND (b.email IS NULL OR b.email = '')
       LIMIT $2`,
      [datasetId, batchSize]
    );

    if (businessesResult.rows.length === 0) {
      console.log(`[Enrichment] No more businesses to enrich in dataset ${datasetId}`);
      break;
    }

    console.log(`[Enrichment] Processing batch ${batch + 1}/${maxBatches}: ${businessesResult.rows.length} businesses`);

    for (const business of businessesResult.rows) {
      const result = await enrichBusinessEmail(business.id);
      totalProcessed++;
      
      if (result.emailFound) {
        totalEmailsFound++;
        if (result.source === 'website') sources.website++;
        else if (result.source === 'facebook') sources.facebook++;
        else if (result.source === 'linkedin') sources.linkedin++;
        else if (result.source === 'existing') sources.existing++;
      }

      // Small delay between businesses to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Delay between batches
    if (batch < maxBatches - 1 && businessesResult.rows.length === batchSize) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  console.log(`[Enrichment] Email enrichment completed for dataset ${datasetId}: ${totalEmailsFound} emails found from ${totalProcessed} businesses`);
  console.log(`[Enrichment] Sources: ${sources.website} website, ${sources.facebook} facebook, ${sources.linkedin} linkedin, ${sources.existing} existing`);

  return {
    processed: totalProcessed,
    emailsFound: totalEmailsFound,
    sources
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
