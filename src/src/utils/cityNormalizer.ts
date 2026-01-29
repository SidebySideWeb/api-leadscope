/**
 * Normalizes city names for consistent matching
 * - Converts to lowercase
 * - Removes Greek accents
 * - Trims whitespace
 */
export function normalizeCityName(cityName: string): string {
  if (!cityName) return '';
  
  return cityName
    .toLowerCase()
    .trim()
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
    .replace(/Ώ/g, 'ω')
    .replace(/\s+/g, ' ')
    .trim();
}
