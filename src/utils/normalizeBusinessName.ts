/**
 * Normalize Business Name Utility
 * 
 * Single source of truth for business name normalization.
 * This function is deterministic, side-effect free, and reusable.
 * 
 * Normalization strategy:
 * - Convert to lowercase
 * - Remove accents (Unicode NFD decomposition + remove combining marks)
 * - Preserve Unicode letters (including Greek, Cyrillic, etc.) and numbers
 * - Replace non-alphanumeric characters with hyphens
 * - Remove leading/trailing hyphens
 * 
 * @param name - Business name to normalize
 * @returns Normalized name (never empty)
 * @throws Error if name is empty or normalization results in empty string
 */
export function normalizeBusinessName(name: string): string {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Cannot generate normalized_name without name');
  }

  // Normalize: lowercase, remove accents, preserve Unicode letters and numbers
  // Use explicit character classes to support Greek, Latin, Cyrillic, etc.
  // \p{L} matches any Unicode letter (requires 'u' flag)
  // \p{N} matches any Unicode number
  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove combining marks (accents)
    .replace(/[^\p{L}\p{N}]+/gu, '-') // Replace non-letters/non-numbers with hyphens (Unicode-aware)
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

  // Validate: normalized name must not be empty
  if (!normalized || normalized.length === 0) {
    throw new Error(`Business name "${name}" normalizes to empty string, which is not allowed`);
  }

  return normalized;
}
