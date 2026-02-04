// Deduplication utilities

/**
 * Normalizes business name for deduplication
 * Uses deterministic normalization strategy:
 * - lowercase
 * - remove accents (Unicode NFD decomposition + remove combining marks)
 * - remove symbols
 * - replace spaces with hyphens
 * 
 * CRITICAL: Missing normalized_name causes silent rollbacks because
 * businesses.normalized_name column is NOT NULL.
 * 
 * @throws Error if normalization results in empty string
 */
export function normalizeBusinessName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('Business name is required and must be a non-empty string');
  }

  // Deterministic normalization strategy
  let normalized = name
    .toLowerCase()
    .normalize('NFD') // Decompose Unicode characters (é -> e + ́)
    .replace(/[\u0300-\u036f]/g, '') // Remove combining diacritical marks (accents)
    .replace(/[^a-z0-9\s]/g, '') // Remove symbols, keep only letters, numbers, spaces
    .trim()
    .replace(/\s+/g, '-'); // Replace spaces with hyphens

  // Validate: normalized name must not be empty
  if (!normalized || normalized.length === 0) {
    throw new Error(`Business name "${name}" normalizes to empty string, which is not allowed`);
  }

  return normalized;
}

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
