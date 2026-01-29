import type { Contact } from '../types/index.js';
import { normalizePhone } from './phoneNormalizer.js';
import { classifyEmail } from './emailClassifier.js';

export interface ContactKey {
  type: 'email' | 'phone' | 'mobile';
  normalizedValue: string;
  businessId: number | null;
}

/**
 * Generate a unique key for contact matching
 */
export function generateContactKey(
  contact: {
    email?: string | null;
    phone?: string | null;
    mobile?: string | null;
    contactType: 'email' | 'phone' | 'mobile';
  },
  businessId: number | null
): ContactKey | null {
  let normalizedValue: string | null = null;

  if (contact.contactType === 'email' && contact.email) {
    try {
      const classified = classifyEmail(contact.email);
      normalizedValue = classified.normalized;
    } catch {
      return null;
    }
  } else if (contact.contactType === 'phone' && contact.phone) {
    const normalized = normalizePhone(contact.phone);
    if (normalized) {
      normalizedValue = normalized.normalized;
    }
  } else if (contact.contactType === 'mobile' && contact.mobile) {
    const normalized = normalizePhone(contact.mobile);
    if (normalized) {
      normalizedValue = normalized.normalized;
    }
  }

  if (!normalizedValue) {
    return null;
  }

  return {
    type: contact.contactType,
    normalizedValue,
    businessId
  };
}

/**
 * Check if two contact keys match
 */
export function contactKeysMatch(key1: ContactKey, key2: ContactKey): boolean {
  return (
    key1.type === key2.type &&
    key1.normalizedValue === key2.normalizedValue &&
    key1.businessId === key2.businessId
  );
}

/**
 * Generate key from existing contact record
 */
export function contactToKey(contact: Contact, businessId: number | null): ContactKey | null {
  return generateContactKey(
    {
      email: contact.email,
      phone: contact.phone,
      mobile: contact.mobile,
      contactType: contact.contact_type
    },
    businessId
  );
}
