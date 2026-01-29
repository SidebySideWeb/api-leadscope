/**
 * Social Media Crawler
 * 
 * Crawls specific social media pages to extract contact information:
 * - Facebook: /directory_contact_info
 * - LinkedIn: /about/
 */

import { fetchUrl } from './fetcher.js';
import { extractEmails, extractPhones } from './extractors.js';

export interface SocialMediaContactResult {
  emails: Array<{ value: string; source_url: string; context?: string }>;
  phones: Array<{ value: string; source_url: string }>;
  success: boolean;
  error?: string;
}

/**
 * Extract page/company identifier from social media URL
 */
function extractSocialMediaIdentifier(url: string, platform: 'facebook' | 'linkedin'): string | null {
  try {
    const urlObj = new URL(url);
    
    if (platform === 'facebook') {
      // Facebook: https://www.facebook.com/Zambri.Kifisia
      // Extract: Zambri.Kifisia
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      if (pathParts.length > 0) {
        return pathParts[0];
      }
    } else if (platform === 'linkedin') {
      // LinkedIn: https://www.linkedin.com/company/zambri-athens
      // Extract: zambri-athens
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      if (pathParts.length >= 2 && pathParts[0] === 'company') {
        return pathParts[1];
      } else if (pathParts.length > 0) {
        // Handle profile URLs too
        return pathParts[pathParts.length - 1];
      }
    }
  } catch (e) {
    // Invalid URL
    return null;
  }
  
  return null;
}

/**
 * Crawl Facebook directory_contact_info page
 */
export async function crawlFacebookContactInfo(facebookUrl: string): Promise<SocialMediaContactResult> {
  const result: SocialMediaContactResult = {
    emails: [],
    phones: [],
    success: false,
  };

  try {
    const identifier = extractSocialMediaIdentifier(facebookUrl, 'facebook');
    if (!identifier) {
      result.error = 'Could not extract Facebook page identifier';
      return result;
    }

    // Build contact info URL: https://www.facebook.com/{page}/directory_contact_info
    const contactInfoUrl = `https://www.facebook.com/${identifier}/directory_contact_info`;

    console.log(`[socialMediaCrawler] Crawling Facebook contact info: ${contactInfoUrl}`);

    const fetchResult = await fetchUrl(contactInfoUrl, { timeout: 10000 });

    if (fetchResult.status !== 200) {
      result.error = `HTTP ${fetchResult.status}`;
      return result;
    }

    // Extract emails and phones from the page
    const emails = extractEmails(fetchResult.content, contactInfoUrl);
    const phones = extractPhones(fetchResult.content, contactInfoUrl);

    result.emails = emails;
    result.phones = phones;
    result.success = true;

    console.log(`[socialMediaCrawler] Facebook: Found ${emails.length} emails, ${phones.length} phones`);

    return result;
  } catch (error: any) {
    result.error = error.message || 'Facebook crawl failed';
    console.warn(`[socialMediaCrawler] Facebook crawl error: ${result.error}`);
    return result;
  }
}

/**
 * Crawl LinkedIn about page
 */
export async function crawlLinkedInAbout(linkedInUrl: string): Promise<SocialMediaContactResult> {
  const result: SocialMediaContactResult = {
    emails: [],
    phones: [],
    success: false,
  };

  try {
    const identifier = extractSocialMediaIdentifier(linkedInUrl, 'linkedin');
    if (!identifier) {
      result.error = 'Could not extract LinkedIn company identifier';
      return result;
    }

    // Build about URL: https://www.linkedin.com/company/{company}/about/
    // Check if it's already a company URL
    let aboutUrl: string;
    if (linkedInUrl.includes('/company/')) {
      aboutUrl = `${linkedInUrl.replace(/\/$/, '')}/about/`;
    } else {
      aboutUrl = `https://www.linkedin.com/company/${identifier}/about/`;
    }

    console.log(`[socialMediaCrawler] Crawling LinkedIn about: ${aboutUrl}`);

    const fetchResult = await fetchUrl(aboutUrl, { timeout: 10000 });

    if (fetchResult.status !== 200) {
      result.error = `HTTP ${fetchResult.status}`;
      return result;
    }

    // Extract emails and phones from the page
    const emails = extractEmails(fetchResult.content, aboutUrl);
    const phones = extractPhones(fetchResult.content, aboutUrl);

    result.emails = emails;
    result.phones = phones;
    result.success = true;

    console.log(`[socialMediaCrawler] LinkedIn: Found ${emails.length} emails, ${phones.length} phones`);

    return result;
  } catch (error: any) {
    result.error = error.message || 'LinkedIn crawl failed';
    console.warn(`[socialMediaCrawler] LinkedIn crawl error: ${result.error}`);
    return result;
  }
}

/**
 * Crawl all available social media pages for a business
 */
export async function crawlSocialMediaPages(social: {
  facebook?: string;
  linkedin?: string;
  instagram?: string;
  twitter?: string;
  youtube?: string;
}): Promise<{
  emails: Array<{ value: string; source_url: string; context?: string }>;
  phones: Array<{ value: string; source_url: string }>;
}> {
  const allEmails = new Map<string, { value: string; source_url: string; context?: string }>();
  const allPhones = new Map<string, { value: string; source_url: string }>();

  // Crawl Facebook contact info page
  if (social.facebook) {
    try {
      const fbResult = await crawlFacebookContactInfo(social.facebook);
      if (fbResult.success) {
        for (const email of fbResult.emails) {
          if (!allEmails.has(email.value)) {
            allEmails.set(email.value, email);
          }
        }
        for (const phone of fbResult.phones) {
          if (!allPhones.has(phone.value)) {
            allPhones.set(phone.value, phone);
          }
        }
      }
      // Small delay between social media requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error: any) {
      console.warn(`[socialMediaCrawler] Facebook crawl failed: ${error.message}`);
    }
  }

  // Crawl LinkedIn about page
  if (social.linkedin) {
    try {
      const liResult = await crawlLinkedInAbout(social.linkedin);
      if (liResult.success) {
        for (const email of liResult.emails) {
          if (!allEmails.has(email.value)) {
            allEmails.set(email.value, email);
          }
        }
        for (const phone of liResult.phones) {
          if (!allPhones.has(phone.value)) {
            allPhones.set(phone.value, phone);
          }
        }
      }
      // Small delay between social media requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error: any) {
      console.warn(`[socialMediaCrawler] LinkedIn crawl failed: ${error.message}`);
    }
  }

  return {
    emails: Array.from(allEmails.values()),
    phones: Array.from(allPhones.values()),
  };
}
