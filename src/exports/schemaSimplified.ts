/**
 * Simplified Export Schema
 * 
 * Exact field list as specified:
 * business_name, industry, city, address, phone, email, website,
 * google_maps_url, rating, reviews_count, contact_page_url,
 * facebook, instagram, linkedin, last_crawled_at
 */

export type ExportTier = 'demo' | 'paid';

/**
 * Simplified ExportRow - Exact field list as specified
 */
export interface SimplifiedExportRow {
  business_name: string;
  industry: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  google_maps_url: string;
  rating: string; // Empty string if null
  reviews_count: string; // Empty string if null
  contact_page_url: string;
  facebook: string;
  instagram: string;
  linkedin: string;
  last_crawled_at: string;
}

/**
 * Input data structure for building simplified export rows
 */
export interface SimplifiedBusinessExportData {
  business: {
    name: string;
    address: string | null;
    google_place_id: string | null;
    rating: number | null;
    reviews_count: number | null;
  };
  industry: {
    name: string;
  } | null;
  city: {
    name: string;
  };
  website: {
    url: string;
    last_crawled_at: Date | null;
  } | null;
  contacts: Array<{
    email: string | null;
    phone: string | null;
    source_url: string;
    page_type: string;
  }>;
  social: {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
  };
}

/**
 * Build simplified export rows from business data
 * Enforces demo tier limit (max 50 rows)
 */
export function buildSimplifiedExportRows(
  businesses: SimplifiedBusinessExportData[],
  exportTier: ExportTier
): SimplifiedExportRow[] {
  const maxRows = exportTier === 'demo' ? 50 : Number.MAX_SAFE_INTEGER;
  const isTruncated = businesses.length > maxRows;
  const rowsToProcess = businesses.slice(0, maxRows);

  console.log(`[buildSimplifiedExportRows] Processing ${rowsToProcess.length} businesses (tier: ${exportTier}, truncated: ${isTruncated})`);

  const rows: SimplifiedExportRow[] = rowsToProcess.map((data) => {
    const business = data.business;
    const industry = data.industry;
    const city = data.city;
    const website = data.website;
    const contacts = data.contacts || [];
    const social = data.social || {};

    // Find best email (first available)
    const emailContact = contacts.find(c => c.email);
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

    const row: SimplifiedExportRow = {
      business_name: business.name || '',
      industry: industry?.name || '',
      city: city?.name || '',
      address: business.address || '',
      phone: phone,
      email: email,
      website: website?.url || '',
      google_maps_url: googleMapsUrl,
      rating: normalize(business.rating),
      reviews_count: normalize(business.reviews_count),
      contact_page_url: contactPageUrl,
      facebook: social.facebook || '',
      instagram: social.instagram || '',
      linkedin: social.linkedin || '',
      last_crawled_at: formatDate(website?.last_crawled_at),
    };

    return row;
  });

  return rows;
}

/**
 * Export simplified rows to CSV format (RFC4180 compatible)
 */
export function exportSimplifiedToCSV(rows: SimplifiedExportRow[]): string {
  if (rows.length === 0) {
    return '';
  }

  // Fixed header order (exact field list as specified)
  const headers: Array<keyof SimplifiedExportRow> = [
    'business_name',
    'industry',
    'city',
    'address',
    'phone',
    'email',
    'website',
    'google_maps_url',
    'rating',
    'reviews_count',
    'contact_page_url',
    'facebook',
    'instagram',
    'linkedin',
    'last_crawled_at',
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
  console.log(`[exportSimplifiedToCSV] Generated CSV with ${rows.length} rows, ${csv.length} bytes`);
  
  return csv;
}

/**
 * Export simplified rows to JSON format with metadata wrapper
 */
export function exportSimplifiedToJSON(rows: SimplifiedExportRow[]): string {
  const totalRows = rows.length;
  const exportedRows = rows.length;

  const result = {
    metadata: {
      total_rows: totalRows,
      exported_rows: exportedRows,
      exported_at: new Date().toISOString(),
      schema_version: 'simplified',
      fields: [
        'business_name',
        'industry',
        'city',
        'address',
        'phone',
        'email',
        'website',
        'google_maps_url',
        'rating',
        'reviews_count',
        'contact_page_url',
        'facebook',
        'instagram',
        'linkedin',
        'last_crawled_at',
      ] as const,
    },
    rows: rows
  };

  const json = JSON.stringify(result, null, 2);
  console.log(`[exportSimplifiedToJSON] Generated JSON with ${rows.length} rows, ${json.length} bytes`);
  
  return json;
}
