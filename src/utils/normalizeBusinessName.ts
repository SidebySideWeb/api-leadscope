/**
 * Normalize Business Name Utility
 * 
 * Single source of truth for business name normalization.
 * This function is deterministic, side-effect free, and reusable.
 * 
 * Normalization strategy:
 * - Convert to lowercase
 * - Remove accents (Unicode NFD decomposition + remove combining marks)
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

  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  // Validate: normalized name must not be empty
  if (!normalized || normalized.length === 0) {
    throw new Error(`Business name "${name}" normalizes to empty string, which is not allowed`);
  }

  return normalized;
}
