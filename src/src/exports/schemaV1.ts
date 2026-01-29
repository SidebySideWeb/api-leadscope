/**
 * Export Schema v1
 * Production-ready export system with CSV and JSON support
 * Server-side enforcement only, no DB access
 */

export type ExportTier = 'demo' | 'paid';

/**
 * ExportRowV1 - Exact schema matching specification
 * All fields in exact order as specified
 */
export interface ExportRowV1 {
  business_id: number;
  dataset_id: string;
  source: string;
  collected_at: string; // ISO 8601 date string
  name: string;
  normalized_name: string;
  category: string;
  city: string;
  region: string;
  country: string;
  address: string;
  latitude: string; // Empty string if null
  longitude: string; // Empty string if null
  website_url: string;
  google_maps_url: string;
  email: string;
  phone: string;
  contact_page_url: string;
  facebook_url: string;
  linkedin_url: string;
  crawl_status: string;
  crawl_depth: string; // Empty string if null
  emails_found_count: string; // Empty string if null
  last_crawled_at: string;
  has_website: string; // 'true' or 'false'
  has_email: string; // 'true' or 'false'
  confidence_score: string; // Empty string if null
  notes: string;
  export_tier: ExportTier;
  row_number: number;
  is_truncated: boolean;
}

/**
 * Input data structure for building export rows
 * Aggregated business data (no DB access)
 */
export interface BusinessExportData {
  business: {
    id: number;
    name: string;
    normalized_name: string;
    address: string | null;
    postal_code: string | null;
    dataset_id: string;
    created_at: Date;
    google_place_id: string | null;
  };
  industry: {
    name: string;
  } | null;
  city: {
    name: string;
    latitude: number | null;
    longitude: number | null;
  };
  country: {
    name: string;
    code: string;
  } | null;
  website: {
    url: string;
    last_crawled_at: Date | null;
  } | null;
  contacts: Array<{
    email: string | null;
    phone: string | null;
    source_url: string;
    page_type: string;
    confidence?: number;
  }>;
  crawlInfo: {
    status: string;
    depth: number | null;
    pages_crawled: number | null;
  } | null;
}

/**
 * Build export rows from business data
 * Enforces demo tier limit (max 50 rows)
 */
export function buildExportRows(
  businesses: BusinessExportData[],
  exportTier: ExportTier
): ExportRowV1[] {
  const maxRows = exportTier === 'demo' ? 50 : Number.MAX_SAFE_INTEGER;
  const isTruncated = businesses.length > maxRows;
  const rowsToProcess = businesses.slice(0, maxRows);

  console.log(`[buildExportRows] Processing ${rowsToProcess.length} businesses (tier: ${exportTier}, truncated: ${isTruncated})`);

  const rows: ExportRowV1[] = rowsToProcess.map((data, index) => {
    const rowNumber = index + 1;
    const business = data.business;
    const industry = data.industry;
    const city = data.city;
    const country = data.country;
    const website = data.website;
    const contacts = data.contacts || [];

    // Find best email (highest confidence or first available)
    const emailContact = contacts
      .filter(c => c.email)
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
    const email = emailContact?.email || '';

    // Find best phone (first available)
    const phoneContact = contacts.find(c => c.phone);
    const phone = phoneContact?.phone || '';

    // Find contact page URL
    const contactPage = contacts.find(c => 
      c.page_type === 'contact' || 
      c.source_url.toLowerCase().includes('/contact') ||
      c.source_url.toLowerCase().includes('/επικοινωνια')
    );
    const contactPageUrl = contactPage?.source_url || '';

    // Find social links
    const facebookUrl = contacts
      .map(c => c.source_url)
      .find(url => url.includes('facebook.com')) || '';
    const linkedinUrl = contacts
      .map(c => c.source_url)
      .find(url => url.includes('linkedin.com')) || '';

    // Count emails found
    const emailsFound = contacts.filter(c => c.email).length;

    // Calculate confidence score (average of contact confidences)
    const confidences = contacts
      .map(c => c.confidence)
      .filter((c): c is number => c !== undefined && c !== null);
    const avgConfidence = confidences.length > 0
      ? (confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(2)
      : '';

    // Determine crawl status
    let crawlStatus = 'not_crawled';
    if (data.crawlInfo) {
      if (data.crawlInfo.status === 'success' || data.crawlInfo.status === 'completed') {
        crawlStatus = 'completed';
      } else if (data.crawlInfo.status === 'failed') {
        crawlStatus = 'failed';
      } else if (data.crawlInfo.status === 'running') {
        crawlStatus = 'in_progress';
      }
    }

    // Build Google Maps URL
    const googleMapsUrl = business.google_place_id
      ? `https://www.google.com/maps/place/?q=place_id:${business.google_place_id}`
      : '';

    // Normalize empty values to empty string
    const normalize = (value: string | number | null | undefined): string => {
      if (value === null || value === undefined) return '';
      return String(value);
    };

    // Format dates
    const formatDate = (date: Date | null | undefined): string => {
      if (!date) return '';
      return date.toISOString();
    };

    const row: ExportRowV1 = {
      business_id: business.id,
      dataset_id: business.dataset_id,
      source: 'google_places', // Default source
      collected_at: formatDate(business.created_at),
      name: business.name || '',
      normalized_name: business.normalized_name || '',
      category: industry?.name || '',
      city: city?.name || '',
      region: '', // Not available in current schema
      country: country?.name || '',
      address: business.address || '',
      latitude: normalize(city?.latitude),
      longitude: normalize(city?.longitude),
      website_url: website?.url || '',
      google_maps_url: googleMapsUrl,
      email: email,
      phone: phone,
      contact_page_url: contactPageUrl,
      facebook_url: facebookUrl,
      linkedin_url: linkedinUrl,
      crawl_status: crawlStatus,
      crawl_depth: normalize(data.crawlInfo?.depth),
      emails_found_count: normalize(emailsFound),
      last_crawled_at: formatDate(website?.last_crawled_at),
      has_website: website ? 'true' : 'false',
      has_email: email ? 'true' : 'false',
      confidence_score: avgConfidence,
      notes: '', // Empty by default
      export_tier: exportTier,
      row_number: rowNumber,
      is_truncated: isTruncated
    };

    return row;
  });

  return rows;
}

/**
 * Export rows to CSV format (RFC4180 compatible)
 * No external CSV libraries - pure TypeScript implementation
 */
export function exportToCSV(rows: ExportRowV1[]): string {
  if (rows.length === 0) {
    return '';
  }

  // Fixed header order (exact schema order)
  const headers: Array<keyof ExportRowV1> = [
    'business_id',
    'dataset_id',
    'source',
    'collected_at',
    'name',
    'normalized_name',
    'category',
    'city',
    'region',
    'country',
    'address',
    'latitude',
    'longitude',
    'website_url',
    'google_maps_url',
    'email',
    'phone',
    'contact_page_url',
    'facebook_url',
    'linkedin_url',
    'crawl_status',
    'crawl_depth',
    'emails_found_count',
    'last_crawled_at',
    'has_website',
    'has_email',
    'confidence_score',
    'notes',
    'export_tier',
    'row_number',
    'is_truncated'
  ];

  // Escape CSV value (RFC4180)
  const escapeCSV = (value: string | number | boolean): string => {
    const str = String(value);
    
    // If contains comma, newline, or double quote, wrap in quotes and escape quotes
    if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    
    return str;
  };

  // Build CSV content
  const lines: string[] = [];

  // Header row
  lines.push(headers.map(h => escapeCSV(h)).join(','));

  // Data rows
  for (const row of rows) {
    const values = headers.map(header => {
      const value = row[header];
      return escapeCSV(value);
    });
    lines.push(values.join(','));
  }

  const csv = lines.join('\n');
  console.log(`[exportToCSV] Generated CSV with ${rows.length} rows, ${csv.length} bytes`);
  
  return csv;
}

/**
 * Export rows to JSON format with metadata wrapper
 */
export function exportToJSON(rows: ExportRowV1[]): string {
  const totalRows = rows.length;
  const exportedRows = rows.length;
  const truncated = rows.length > 0 && rows[0].is_truncated;
  const exportTier = rows.length > 0 ? rows[0].export_tier : 'demo';

  const result = {
    metadata: {
      total_rows: totalRows,
      exported_rows: exportedRows,
      export_tier: exportTier,
      truncated: truncated,
      exported_at: new Date().toISOString(),
      schema_version: 'v1'
    },
    rows: rows
  };

  const json = JSON.stringify(result, null, 2);
  console.log(`[exportToJSON] Generated JSON with ${rows.length} rows, ${json.length} bytes`);
  
  return json;
}

/**
 * Type guard to validate ExportRowV1
 */
export function isValidExportRow(row: unknown): row is ExportRowV1 {
  if (typeof row !== 'object' || row === null) {
    return false;
  }

  const r = row as Record<string, unknown>;
  const requiredFields: Array<keyof ExportRowV1> = [
    'business_id',
    'dataset_id',
    'source',
    'collected_at',
    'name',
    'normalized_name',
    'category',
    'city',
    'region',
    'country',
    'address',
    'latitude',
    'longitude',
    'website_url',
    'google_maps_url',
    'email',
    'phone',
    'contact_page_url',
    'facebook_url',
    'linkedin_url',
    'crawl_status',
    'crawl_depth',
    'emails_found_count',
    'last_crawled_at',
    'has_website',
    'has_email',
    'confidence_score',
    'notes',
    'export_tier',
    'row_number',
    'is_truncated'
  ];

  return requiredFields.every(field => field in r);
}
