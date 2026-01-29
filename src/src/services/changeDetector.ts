import { pool } from '../config/database.js';
import type { Contact, Website } from '../types/index.js';
import type { ExtractedContact } from '../types/index.js';
import { generateContactKey } from '../utils/contactComparator.js';
import { getOrCreateContact } from '../db/contacts.js';
import { createContactSource } from '../db/contactSources.js';
import type { CrawlResult } from '../types/index.js';

export interface ContactChange {
  contactId: number;
  action: 'added' | 'verified' | 'deactivated';
}

export interface ChangeDetectionResult {
  added: number;
  verified: number;
  deactivated: number;
  changes: ContactChange[];
}

/**
 * Detect changes in contacts for a website
 * Compares extracted contacts with existing ones
 */
export async function detectContactChanges(
  website: Website,
  crawlResults: CrawlResult[],
  extractedContacts: ExtractedContact[]
): Promise<ChangeDetectionResult> {
  const result: ChangeDetectionResult = {
    added: 0,
    verified: 0,
    deactivated: 0,
    changes: []
  };

  // Get existing contacts for this website's business
  const existingContacts = await getExistingContactsForBusiness(website.business_id);

  // Generate keys for existing contacts
  const existingKeys = new Map<string, Contact>();
  for (const contact of existingContacts) {
    const key = generateContactKey(
      {
        email: contact.email,
        phone: contact.phone,
        mobile: contact.mobile,
        contactType: contact.contact_type
      },
      website.business_id
    );

    if (key) {
      const keyString = JSON.stringify(key);
      existingKeys.set(keyString, contact);
    }
  }

  // Process extracted contacts
  const foundKeys = new Set<string>();

  for (const extracted of extractedContacts) {
    const key = generateContactKey(extracted, website.business_id);
    if (!key) continue;

    const keyString = JSON.stringify(key);
    foundKeys.add(keyString);

    const existing = existingKeys.get(keyString);

    if (existing) {
      // Contact still exists - verify it
      await verifyContact(existing.id);
      result.verified++;
      result.changes.push({
        contactId: existing.id,
        action: 'verified'
      });
    } else {
      // New contact - add it
      const contact = await getOrCreateContact({
        email: extracted.email || null,
        phone: extracted.contactType === 'phone' ? extracted.phone || null : null,
        mobile: extracted.contactType === 'mobile' ? extracted.mobile || null : null,
        contact_type: extracted.contactType,
        is_generic: extracted.isGeneric
      });

      // Create source for new contact
      // Use the first crawl result (homepage preferred)
      const sourceResult = crawlResults.find(r => r.pageType === 'homepage') || crawlResults[0];
      if (sourceResult) {
        await createContactSource({
          contact_id: contact.id,
          source_url: sourceResult.url,
          page_type: sourceResult.pageType,
          html_hash: sourceResult.htmlHash
        });
      }

      result.added++;
      result.changes.push({
        contactId: contact.id,
        action: 'added'
      });
    }
  }

  // Deactivate contacts that were not found
  for (const [keyString, contact] of existingKeys.entries()) {
    if (!foundKeys.has(keyString) && contact.is_active) {
      await deactivateContact(contact.id);
      result.deactivated++;
      result.changes.push({
        contactId: contact.id,
        action: 'deactivated'
      });
    }
  }

  return result;
}

/**
 * Get existing active contacts for a business
 */
async function getExistingContactsForBusiness(
  businessId: number | null
): Promise<Contact[]> {
  if (!businessId) {
    return [];
  }

  // Get contacts through contact_sources that reference this business's websites
  const result = await pool.query<Contact>(
    `SELECT DISTINCT c.*
     FROM contacts c
     JOIN contact_sources cs ON c.id = cs.contact_id
     JOIN websites w ON cs.source_url LIKE '%' || w.url || '%'
     WHERE w.business_id = $1
       AND c.is_active = TRUE`,
    [businessId]
  );

  return result.rows;
}

/**
 * Verify a contact (update last_verified_at and set is_active)
 */
async function verifyContact(contactId: number): Promise<void> {
  await pool.query(
    `UPDATE contacts
     SET last_verified_at = NOW(), is_active = TRUE
     WHERE id = $1`,
    [contactId]
  );
}

/**
 * Deactivate a contact (set is_active = false)
 */
async function deactivateContact(contactId: number): Promise<void> {
  await pool.query(
    `UPDATE contacts
     SET is_active = FALSE
     WHERE id = $1`,
    [contactId]
  );
}
