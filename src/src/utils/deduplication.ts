// Deduplication utilities

/**
 * Normalizes business name for deduplication
 * - lowercase
 * - remove accents
 * - replace symbols with dash
 * - trim dashes
 * 
 * @throws Error if normalization results in empty string
 */
export function normalizeBusinessName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('Business name is required and must be a non-empty string');
  }

  let normalized = name
    .toLowerCase()
    .trim();

  // Remove Greek accents (similar to cityNormalizer)
  normalized = normalized
    .replace(/ά/g, 'α')
    .replace(/έ/g, 'ε')
    .replace(/ή/g, 'η')
    .replace(/ί/g, 'ι')
    .replace(/ό/g, 'ο')
    .replace(/ύ/g, 'υ')
    .replace(/ώ/g, 'ω')
    .replace(/Ά/g, 'α')
    .replace(/Έ/g, 'ε')
    .replace(/Ή/g, 'η')
    .replace(/Ί/g, 'ι')
    .replace(/Ό/g, 'ο')
    .replace(/Ύ/g, 'υ')
    .replace(/Ώ/g, 'ω');

  // Replace symbols and special characters with dash
  normalized = normalized.replace(/[^\w\s-]/g, '-');

  // Normalize whitespace to single spaces
  normalized = normalized.replace(/\s+/g, ' ');

  // Replace spaces with dashes
  normalized = normalized.replace(/\s/g, '-');

  // Remove multiple consecutive dashes
  normalized = normalized.replace(/-+/g, '-');

  // Trim dashes from start and end
  normalized = normalized.replace(/^-+|-+$/g, '');

  // Final trim
  normalized = normalized.trim();

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
