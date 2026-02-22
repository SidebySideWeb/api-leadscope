/**
 * Format date as ddmoyr (e.g., "15Jan2025")
 * No gaps between day, month, and year
 */
export function formatDateForName(date: Date = new Date()): string {
  const day = date.getDate().toString().padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear().toString();
  
  return `${day}${month}${year}`;
}

/**
 * Format dataset name: "Prefecture - Industry - Date"
 * Example: "Attica - Healthcare - 15Jan2025"
 */
export function formatDatasetName(prefecture: string, industry: string, date?: Date): string {
  const dateStr = formatDateForName(date);
  return `${prefecture} - ${industry} - ${dateStr}`;
}

/**
 * Format export filename: "Prefecture - Industry - Date"
 * Example: "Attica - Healthcare - 15Jan2025"
 */
export function formatExportFilename(prefecture: string, industry: string, date?: Date, extension: string = 'xlsx'): string {
  const dateStr = formatDateForName(date);
  return `${prefecture} - ${industry} - ${dateStr}.${extension}`;
}
