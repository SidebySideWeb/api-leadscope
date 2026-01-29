import * as cheerio from 'cheerio';
import type { CrawlResult, ExtractedContact } from '../types/index.js';
import { getOrCreateContact } from '../db/contacts.js';
import { createContactSource } from '../db/contactSources.js';
import { normalizePhone } from '../utils/phoneNormalizer.js';
import { classifyEmail } from '../utils/emailClassifier.js';

// Email regex pattern
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Phone regex patterns
const PHONE_REGEX = /(?:\+30|0030|0)?\s*[2-9]\d{1,3}\s*[0-9]\d{6,8}/g;
const MOBILE_REGEX = /(?:\+30|0030|0)?\s*69\d{8}/g;

export async function extractContacts(crawlResults: CrawlResult[]): Promise<number> {
  let contactsCreated = 0;

  for (const result of crawlResults) {
    try {
      const contacts = extractFromHtml(result.html, result.url);

      for (const contact of contacts) {
        try {
          // Create or get contact
          const contactRecord = await getOrCreateContact({
            email: contact.email || null,
            phone: contact.contactType === 'phone' ? contact.phone || null : null,
            mobile: contact.contactType === 'mobile' ? contact.mobile || null : null,
            contact_type: contact.contactType,
            is_generic: contact.isGeneric
          });

          // Create contact source (mandatory)
          await createContactSource({
            contact_id: contactRecord.id,
            source_url: result.url,
            page_type: result.pageType,
            html_hash: result.htmlHash
          });

          contactsCreated++;
        } catch (error) {
          console.error(`Error saving contact from ${result.url}:`, error);
        }
      }
    } catch (error) {
      console.error(`Error extracting contacts from ${result.url}:`, error);
    }
  }

  return contactsCreated;
}

export function extractFromHtml(html: string, _url: string): ExtractedContact[] {
  const contacts: ExtractedContact[] = [];
  const $ = cheerio.load(html);

  // Extract emails from text and mailto: links
  const emailMatches: string[] = html.match(EMAIL_REGEX) || [];
  const uniqueEmails = new Set<string>();

  // Also extract from mailto: links
  $('a[href^="mailto:"]').each((_, element) => {
    const href = $(element).attr('href');
    if (href) {
      const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
      if (email) {
        emailMatches.push(email);
      }
    }
  });

  for (const email of emailMatches) {
    try {
      const normalized = email.toLowerCase().trim();
      if (normalized && !uniqueEmails.has(normalized)) {
        uniqueEmails.add(normalized);
        const classification = classifyEmail(normalized);
        contacts.push({
          email: classification.normalized,
          contactType: 'email',
          isGeneric: classification.isGeneric
        });
      }
    } catch (error) {
      console.warn(`Invalid email: ${email}`);
    }
  }

  // Extract phones
  const phoneMatches = html.match(PHONE_REGEX) || [];
  const mobileMatches = html.match(MOBILE_REGEX) || [];
  const uniquePhones = new Set<string>();

  // Process mobile numbers
  for (const phone of mobileMatches) {
    const normalized = normalizePhone(phone);
    if (normalized && !uniquePhones.has(normalized.normalized)) {
      uniquePhones.add(normalized.normalized);
      contacts.push({
        mobile: normalized.normalized,
        contactType: 'mobile',
        isGeneric: false
      });
    }
  }

  // Process landline numbers
  for (const phone of phoneMatches) {
    const normalized = normalizePhone(phone);
    if (normalized && !normalized.isMobile && !uniquePhones.has(normalized.normalized)) {
      uniquePhones.add(normalized.normalized);
      contacts.push({
        phone: normalized.normalized,
        contactType: 'phone',
        isGeneric: false
      });
    }
  }

  // Also check structured data (schema.org, microdata, etc.)
  $('[itemtype*="schema.org/Organization"], [itemtype*="schema.org/LocalBusiness"]').each((_, element) => {
    const $el = $(element);
    
    // Extract email from schema.org
    $el.find('[itemprop="email"]').each((_, emailEl) => {
      const email = $(emailEl).text().trim() || $(emailEl).attr('href')?.replace('mailto:', '');
      if (email) {
        try {
          const normalized = email.toLowerCase().trim();
          if (!uniqueEmails.has(normalized)) {
            uniqueEmails.add(normalized);
            const classification = classifyEmail(normalized);
            contacts.push({
              email: classification.normalized,
              contactType: 'email',
              isGeneric: classification.isGeneric
            });
          }
        } catch {
          // Invalid email
        }
      }
    });

    // Extract phone from schema.org
    $el.find('[itemprop="telephone"]').each((_, phoneEl) => {
      const phone = $(phoneEl).text().trim();
      if (phone) {
        const normalized = normalizePhone(phone);
        if (normalized && !uniquePhones.has(normalized.normalized)) {
          uniquePhones.add(normalized.normalized);
          contacts.push({
            phone: normalized.isMobile ? undefined : normalized.normalized,
            mobile: normalized.isMobile ? normalized.normalized : undefined,
            contactType: normalized.isMobile ? 'mobile' : 'phone',
            isGeneric: false
          });
        }
      }
    });
  });

  return contacts;
}
