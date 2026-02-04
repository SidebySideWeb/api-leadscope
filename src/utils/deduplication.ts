// Deduplication utilities

// Import and re-export normalizeBusinessName from the single source of truth
import { normalizeBusinessName } from './normalizeBusinessName.js';
export { normalizeBusinessName };

/**
 * Checks if two businesses are duplicates
 * Primary: google_place_id
 * Secondary: normalized name + address
 */
export function areBusinessesDuplicate(
  business1: { google_place_id?: string | null; name: string; address?: string | null },
  business2: { google_place_id?: string | null; name: string; address?: string | null }
): boolean {
  // Primary: google_place_id match
  if (business1.google_place_id && business2.google_place_id) {
    return business1.google_place_id === business2.google_place_id;
  }

  // Secondary: normalized name + address match
  const name1 = normalizeBusinessName(business1.name);
  const name2 = normalizeBusinessName(business2.name);
  
  if (name1 !== name2) {
    return false;
  }

  // If names match, check addresses if both exist
  if (business1.address && business2.address) {
    const addr1 = business1.address.toLowerCase().trim();
    const addr2 = business2.address.toLowerCase().trim();
    return addr1 === addr2;
  }

  // If only names match and one or both addresses are missing, consider it a potential duplicate
  // (This is a conservative approach - you may want to adjust based on your needs)
  return name1 === name2 && name1.length > 0;
}
