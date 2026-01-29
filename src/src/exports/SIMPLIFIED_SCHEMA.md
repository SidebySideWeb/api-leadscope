# Simplified Export Schema

A simplified export schema with exactly 15 fields as specified.

## Fields

1. `business_name` - Business name
2. `industry` - Industry/category name
3. `city` - City name
4. `address` - Full address
5. `phone` - Best phone number
6. `email` - Best email address
7. `website` - Website URL
8. `google_maps_url` - Google Maps URL (if place_id available)
9. `rating` - Google Places rating (empty if not available)
10. `reviews_count` - Number of reviews (empty if not available)
11. `contact_page_url` - Contact page URL
12. `facebook` - Facebook URL
13. `instagram` - Instagram URL
14. `linkedin` - LinkedIn URL
15. `last_crawled_at` - Last crawl timestamp (ISO 8601)

## Usage

```typescript
import { 
  buildSimplifiedExportRows, 
  exportSimplifiedToCSV, 
  exportSimplifiedToJSON,
  type SimplifiedBusinessExportData 
} from './schemaSimplified.js';

// Prepare business data
const businesses: SimplifiedBusinessExportData[] = [
  {
    business: {
      name: 'Example Business',
      address: '123 Main St',
      google_place_id: 'ChIJ...',
      rating: 4.5,
      reviews_count: 120
    },
    industry: { name: 'Restaurants' },
    city: { name: 'Athens' },
    website: {
      url: 'https://example.com',
      last_crawled_at: new Date()
    },
    contacts: [
      {
        email: 'info@example.com',
        phone: '+30 210 1234567',
        source_url: 'https://example.com/contact',
        page_type: 'contact'
      }
    ],
    social: {
      facebook: 'https://facebook.com/example',
      instagram: 'https://instagram.com/example',
      linkedin: 'https://linkedin.com/company/example'
    }
  }
];

// Build export rows (enforces demo tier limit: max 50 rows)
const rows = buildSimplifiedExportRows(businesses, 'demo');

// Export to CSV
const csv = exportSimplifiedToCSV(rows);

// Export to JSON
const json = exportSimplifiedToJSON(rows);
```

## Data Sources

- **Rating & Reviews Count**: Fetched from Google Places API (New) when getting place details
- **Social Links**: Extracted from website crawl results
- **Contact Info**: Extracted from website crawl results
- **Google Maps URL**: Generated from `google_place_id` if available

## Notes

- All fields return empty strings (`''`) if data is not available
- Dates are formatted as ISO 8601 strings
- CSV export is RFC4180 compliant
- Demo tier limits exports to 50 rows maximum
