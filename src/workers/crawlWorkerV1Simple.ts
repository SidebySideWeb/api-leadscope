/**
 * Crawl Worker v1 - Simple Version
 * 
 * Input:
 * - business { id, website }
 * - maxDepth (number)
 * 
 * Behavior:
 * - Crawl homepage
 * - Follow internal links containing: contact, about, επικοινωνία
 * - Stop at maxDepth
 * - Extract: emails, phone numbers, social links
 * - Deduplicate results
 * - Save results to local dataset store
 * 
 * Constraints:
 * - No Redis
 * - No queues
 * - Use fetch/axios
 * - Timeout per page: 10s
 */

import { fetchUrl } from '../crawl/fetcher.js';
import { parseHtml, isContactPage } from '../crawl/parser.js';
import { extractEmails, extractPhones, extractSocial } from '../crawl/extractors.js';
import { normalizeUrl, canonicalize, sameRegistrableDomain, extractDomain, resolveUrl } from '../crawl/url.js';
import { saveContacts, loadContacts } from '../storage/localDatasetStore.js';
import { upsertCrawlResultV1 } from '../db/crawlResultsV1.js';
import { crawlSocialMediaPages } from '../crawl/socialMediaCrawler.js';
import type { Contact } from '../types/index.js';

export interface CrawlWorkerV1SimpleInput {
  business: {
    id: number;
    website: string;
  };
  maxDepth: number;
  pagesLimit?: number; // Optional pages limit (if not provided, no limit enforced)
  datasetId: string; // For saving to local store
}

export interface CrawlWorkerV1SimpleResult {
  success: boolean;
  business_id: number;
  website_url: string;
  pages_crawled: number;
  emails_found: number;
  phones_found: number;
  social_links_found: number;
  contacts_saved: number;
  error?: string;
}

// Contact page keywords (English and Greek)
const CONTACT_KEYWORDS = [
  'contact',
  'about',
  'επικοινωνία', // Greek: contact
  'επικοινωνια', // Greek: contact (without accent)
];

/**
 * Check if URL path contains contact keywords
 */
function isContactRelatedUrl(url: string): boolean {
  const urlLower = url.toLowerCase();
  return CONTACT_KEYWORDS.some(keyword => urlLower.includes(keyword));
}

/**
 * Check if link anchor text contains contact keywords
 */
function isContactRelatedAnchor(anchorText: string): boolean {
  const anchorLower = anchorText.toLowerCase();
  return CONTACT_KEYWORDS.some(keyword => anchorLower.includes(keyword));
}

/**
 * Crawl Worker v1 - Simple Version
 */
export async function crawlWorkerV1Simple(
  input: CrawlWorkerV1SimpleInput
): Promise<CrawlWorkerV1SimpleResult> {
  const { business, maxDepth, pagesLimit, datasetId } = input;
  const { id: businessId, website } = business;

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [];
  
  // Deduplicated results
  const allEmails = new Map<string, { value: string; source_url: string }>();
  const allPhones = new Map<string, { value: string; source_url: string }>();
  const allSocial: {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
    twitter?: string;
    youtube?: string;
  } = {};
  
  // Track errors and contact pages for DB persistence (declared outside try for catch block access)
  const errors: Array<{ url?: string; message: string; code?: string }> = [];
  const contactPages = new Set<string>();
  
  // Track crawl start time (declared outside try for catch block access)
  const startedAt = new Date();

  try {
    // 1. Normalize and validate website URL
    const normalized = normalizeUrl(website);
    if (!normalized) {
      return {
        success: false,
        business_id: businessId,
        website_url: website,
        pages_crawled: 0,
        emails_found: 0,
        phones_found: 0,
        social_links_found: 0,
        contacts_saved: 0,
        error: `Invalid website URL: ${website}`,
      };
    }

    const baseDomain = extractDomain(normalized) || '';
    
    // 2. Start with homepage
    queue.push({ url: normalized, depth: 0 });
    visited.add(canonicalize(normalized));

    // 3. BFS crawl with pages limit
    while (queue.length > 0) {
      // Check pages limit if set
      if (pagesLimit !== undefined && visited.size >= pagesLimit) {
        console.log(`[crawlWorkerV1Simple] Pages limit reached: ${pagesLimit} pages`);
        break;
      }

      const { url, depth } = queue.shift()!;

      // Stop if max depth reached
      if (depth > maxDepth) {
        continue;
      }

      try {
        // Fetch page with 10s timeout
        const fetchResult = await fetchUrl(url, { timeout: 10000 });

        if (fetchResult.status !== 200) {
          const errorMsg = `HTTP ${fetchResult.status} for ${url}`;
          console.warn(`[crawlWorkerV1Simple] ${errorMsg}`);
          errors.push({ url, message: errorMsg, code: `HTTP_${fetchResult.status}` });
          continue;
        }

        // Parse HTML
        const parsed = parseHtml(fetchResult.content, fetchResult.finalUrl, baseDomain);

        // Track contact pages
        if (isContactPage(url, '')) {
          contactPages.add(url);
        }
        for (const contactUrl of parsed.contactPageUrls) {
          contactPages.add(contactUrl);
        }

        // Extract emails
        const emails = extractEmails(fetchResult.content, fetchResult.finalUrl, parsed.text);
        for (const email of emails) {
          if (!allEmails.has(email.value)) {
            allEmails.set(email.value, {
              value: email.value,
              source_url: email.source_url,
            });
          }
        }

        // Extract phones
        const phones = extractPhones(fetchResult.content, fetchResult.finalUrl);
        for (const phone of phones) {
          if (!allPhones.has(phone.value)) {
            allPhones.set(phone.value, {
              value: phone.value,
              source_url: phone.source_url,
            });
          }
        }

        // Extract social links (only from homepage - depth 0)
        if (depth === 0) {
          const social = extractSocial(fetchResult.content, fetchResult.finalUrl);
          if (social.facebook) allSocial.facebook = social.facebook;
          if (social.instagram) allSocial.instagram = social.instagram;
          if (social.linkedin) allSocial.linkedin = social.linkedin;
          if (social.twitter) allSocial.twitter = social.twitter;
          if (social.youtube) allSocial.youtube = social.youtube;
        }

        // Add contact-related links to queue
        if (depth < maxDepth) {
          // Follow links that are contact-related (by URL or detected as contact pages)
          const linksToFollow = new Set<string>();
          
          // Add all links that match contact keywords in URL
          for (const link of parsed.links) {
            const canonical = canonicalize(link);
            if (isContactRelatedUrl(canonical)) {
              linksToFollow.add(link);
            }
          }
          
          // Add all detected contact page URLs (includes anchor text matching)
          for (const contactUrl of parsed.contactPageUrls) {
            linksToFollow.add(contactUrl);
          }
          
          // Add to queue if not already visited and same domain
          for (const link of linksToFollow) {
            const canonical = canonicalize(link);
            
            // Skip if already visited
            if (visited.has(canonical)) {
              continue;
            }
            
            // Verify it's same domain
            if (sameRegistrableDomain(link, baseDomain)) {
              visited.add(canonical);
              queue.push({ url: link, depth: depth + 1 });
            }
          }
        }

        // Small delay between requests (rate limiting)
        if (queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      } catch (error: any) {
        const errorMsg = error.message || 'Unknown error';
        console.warn(`[crawlWorkerV1Simple] Error crawling ${url}:`, errorMsg);
        errors.push({ url, message: errorMsg });
        // Continue with next URL
        continue;
      }
    }

    // 4. Crawl social media pages for additional contacts
    // Only crawl if we found social links on the homepage
    if (Object.keys(allSocial).length > 0) {
      console.log(`[crawlWorkerV1Simple] Crawling social media pages for additional contacts...`);
      try {
        const socialMediaContacts = await crawlSocialMediaPages(allSocial);
        
        // Add emails from social media
        for (const email of socialMediaContacts.emails) {
          if (!allEmails.has(email.value)) {
            allEmails.set(email.value, {
              value: email.value,
              source_url: email.source_url,
            });
          }
        }
        
        // Add phones from social media
        for (const phone of socialMediaContacts.phones) {
          if (!allPhones.has(phone.value)) {
            allPhones.set(phone.value, {
              value: phone.value,
              source_url: phone.source_url,
            });
          }
        }
        
        console.log(`[crawlWorkerV1Simple] Social media crawl: Added ${socialMediaContacts.emails.length} emails, ${socialMediaContacts.phones.length} phones`);
      } catch (error: any) {
        console.warn(`[crawlWorkerV1Simple] Social media crawl failed: ${error.message}`);
        // Continue even if social media crawl fails
      }
    }

    // 5. Convert extracted data to Contact format and deduplicate
    const contacts: Contact[] = [];
    const contactIds = new Set<string>(); // For deduplication

    // Add emails as contacts
    for (const email of allEmails.values()) {
      const contactKey = `email:${email.value}`;
      if (!contactIds.has(contactKey)) {
        contactIds.add(contactKey);
        contacts.push({
          id: contacts.length + 1, // Simple ID assignment
          email: email.value,
          phone: null,
          mobile: null,
          contact_type: 'email',
          is_generic: email.value.includes('info@') || email.value.includes('contact@') || email.value.includes('hello@'),
          first_seen_at: new Date(),
          last_verified_at: new Date(),
          is_active: true,
          created_at: new Date(),
        });
      }
    }

    // Add phones as contacts
    for (const phone of allPhones.values()) {
      const contactKey = `phone:${phone.value}`;
      if (!contactIds.has(contactKey)) {
        contactIds.add(contactKey);
        // Determine if mobile (Greek mobile numbers start with 69)
        const isMobile = phone.value.startsWith('+3069');
        contacts.push({
          id: contacts.length + 1,
          email: null,
          phone: !isMobile ? phone.value : null,
          mobile: isMobile ? phone.value : null,
          contact_type: isMobile ? 'mobile' : 'phone',
          is_generic: false,
          first_seen_at: new Date(),
          last_verified_at: new Date(),
          is_active: true,
          created_at: new Date(),
        });
      }
    }

    // 6. Merge with existing contacts and save to local dataset store
    let newContactsCount = 0;
    if (contacts.length > 0) {
      // Load existing contacts to avoid duplicates
      const existingContacts = await loadContacts(datasetId);
      
      // Create a map of existing contacts by key (email or phone)
      const existingMap = new Map<string, Contact>();
      for (const contact of existingContacts) {
        const key = contact.email 
          ? `email:${contact.email.toLowerCase()}` 
          : contact.phone 
          ? `phone:${contact.phone}` 
          : contact.mobile 
          ? `phone:${contact.mobile}` 
          : null;
        if (key) {
          existingMap.set(key, contact);
        }
      }
      
      // Find max ID from existing contacts
      const maxId = existingContacts.length > 0 
        ? Math.max(...existingContacts.map(c => c.id), 0)
        : 0;
      
      // Merge new contacts with existing (skip duplicates)
      const mergedContacts: Contact[] = [...existingContacts];
      
      for (const contact of contacts) {
        const key = contact.email 
          ? `email:${contact.email.toLowerCase()}` 
          : contact.phone 
          ? `phone:${contact.phone}` 
          : contact.mobile 
          ? `phone:${contact.mobile}` 
          : null;
        
        if (key && !existingMap.has(key)) {
          // Assign unique ID
          contact.id = maxId + newContactsCount + 1;
          mergedContacts.push(contact);
          existingMap.set(key, contact);
          newContactsCount++;
        }
      }
      
      // Save merged contacts
      await saveContacts(datasetId, mergedContacts);
    }

    // 7. Persist crawl result to database (if available)
    const finishedAt = new Date();
    const pagesVisited = visited.size;
    
    // Determine crawl_status: 'completed' if we visited at least 1 page and no errors, 'partial' if errors, 'not_crawled' if 0 pages
    let crawlStatus: 'not_crawled' | 'partial' | 'completed';
    if (pagesVisited === 0) {
      crawlStatus = 'not_crawled';
    } else if (errors.length > 0) {
      crawlStatus = 'partial';
    } else {
      crawlStatus = 'completed';
    }

    // Convert businessId (number) to string for DB
    const businessIdStr = String(businessId);

    // Prepare data for DB persistence
    try {
      await upsertCrawlResultV1({
        businessId: businessIdStr,
        datasetId,
        websiteUrl: normalized,
        startedAt,
        finishedAt,
        pagesVisited,
        crawlStatus,
        emails: Array.from(allEmails.values()),
        phones: Array.from(allPhones.values()),
        contactPages: Array.from(contactPages),
        social: allSocial,
        errors,
      });
      console.log(`[crawl_results] Upserted v1 row for business ${businessIdStr} dataset ${datasetId}`);
    } catch (dbError: any) {
      // Log warning but don't fail the crawl
      console.warn(`[crawl_results] Failed to upsert v1 row, falling back to local store: ${dbError.message}`);
    }

    // 8. Return result
    return {
      success: true,
      business_id: businessId,
      website_url: normalized,
      pages_crawled: pagesVisited,
      emails_found: allEmails.size,
      phones_found: allPhones.size,
      social_links_found: Object.keys(allSocial).length,
      contacts_saved: newContactsCount, // New contacts added (not total)
    };
  } catch (error: any) {
    console.error(`[crawlWorkerV1Simple] Error crawling business ${businessId}:`, error);
    
    // Try to persist partial results even on failure
    const finishedAt = new Date();
    const pagesVisited = visited.size;
    const businessIdStr = String(businessId);
    
    // Determine crawl_status: always 'partial' on error
    const crawlStatus: 'partial' = 'partial';
    
    // Add the main error to errors array
    const finalErrors = [...errors, { message: error.message || 'Crawl failed' }];
    
    try {
      await upsertCrawlResultV1({
        businessId: businessIdStr,
        datasetId,
        websiteUrl: website,
        startedAt: startedAt || new Date(),
        finishedAt,
        pagesVisited,
        crawlStatus,
        emails: Array.from(allEmails.values()),
        phones: Array.from(allPhones.values()),
        contactPages: Array.from(contactPages),
        social: allSocial,
        errors: finalErrors,
      });
      console.log(`[crawl_results] Upserted v1 row (partial/failed) for business ${businessIdStr} dataset ${datasetId}`);
    } catch (dbError: any) {
      console.warn(`[crawl_results] Failed to upsert v1 row on error, falling back to local store: ${dbError.message}`);
    }
    
    return {
      success: false,
      business_id: businessId,
      website_url: website,
      pages_crawled: pagesVisited,
      emails_found: allEmails.size,
      phones_found: allPhones.size,
      social_links_found: Object.keys(allSocial).length,
      contacts_saved: 0,
      error: error.message || 'Crawl failed',
    };
  }
}
