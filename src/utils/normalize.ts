import { normalizeBusinessName } from './deduplication.js';

export interface BusinessIdentifierInput {
  name: string | null | undefined;
  googlePlaceId?: string | null;
  businessId?: number | string | null;
}

/**
 * Computes a stable, non-empty normalized identifier for a business.
 *
 * Fallback order:
 *  1. normalized(name) using normalizeBusinessName(...)
 *  2. google_place_id (if present)
 *  3. stringified business_id
 *
 * Throws if no stable identifier can be produced.
 */
export function computeNormalizedBusinessId(
  input: BusinessIdentifierInput
): string {
  const { name, googlePlaceId, businessId } = input;

  // Primary: normalized business name
  if (name && name.trim().length > 0) {
    try {
      const normalized = normalizeBusinessName(name);
      if (normalized && normalized.length > 0) {
        return normalized;
      }
    } catch {
      // Ignore here; try fallbacks below
    }
  }

  // Secondary: use Google place ID as stable identifier
  if (googlePlaceId && googlePlaceId.trim().length > 0) {
    return googlePlaceId.trim().toLowerCase();
  }

  // Tertiary: fall back to business ID if available
  if (businessId !== undefined && businessId !== null) {
    const idStr = String(businessId).trim();
    if (idStr.length > 0) {
      return idStr.toLowerCase();
    }
  }

  throw new Error(
    'Unable to compute stable normalized business identifier: missing name, place ID, and business ID.'
  );
}

