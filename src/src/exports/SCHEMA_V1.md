# Export Schema v1

Production-ready export system for lead-generation platform with CSV and JSON support.

## Features

- **Exact Schema**: 30 fields in specified order
- **Server-side Enforcement**: Demo tier max 50 rows, paid tier unlimited
- **RFC4180 CSV**: Compatible CSV export (no external libraries)
- **JSON Export**: Metadata-wrapped JSON output
- **No DB Access**: Pure transformation functions
- **Deterministic**: Same input always produces same output
- **TypeScript Strict**: Full type safety

## Schema Fields

All fields in exact order:

1. `business_id` - Business ID (number)
2. `dataset_id` - Dataset UUID (string)
3. `source` - Data source (e.g., "google_places")
4. `collected_at` - ISO 8601 date string
5. `name` - Business name
6. `normalized_name` - Normalized business name
7. `category` - Industry/category name
8. `city` - City name
9. `region` - Region (empty if not available)
10. `country` - Country name
11. `address` - Full address
12. `latitude` - Latitude (empty string if null)
13. `longitude` - Longitude (empty string if null)
14. `website_url` - Website URL
15. `google_maps_url` - Google Maps URL (if place_id available)
16. `email` - Best email (highest confidence)
17. `phone` - Best phone number
18. `contact_page_url` - Contact page URL
19. `facebook_url` - Facebook URL (if found)
20. `linkedin_url` - LinkedIn URL (if found)
21. `crawl_status` - Crawl status (not_crawled, in_progress, completed, failed)
22. `crawl_depth` - Crawl depth (empty if null)
23. `emails_found_count` - Number of emails found
24. `last_crawled_at` - Last crawl timestamp (ISO 8601)
25. `has_website` - "true" or "false"
26. `has_email` - "true" or "false"
27. `confidence_score` - Average confidence (0-1, empty if null)
28. `notes` - Notes field (empty by default)
29. `export_tier` - Export tier ("demo" or "paid")
30. `row_number` - Row number (starts at 1)
31. `is_truncated` - Boolean indicating if data was truncated

## Usage

### Building Export Rows

```typescript
import { buildExportRows, type BusinessExportData } from './schemaV1.js';

const businesses: BusinessExportData[] = [
  // ... aggregated business data
];

// Demo tier: max 50 rows
const demoRows = buildExportRows(businesses, 'demo');

// Paid tier: unlimited
const paidRows = buildExportRows(businesses, 'paid');
```

### CSV Export

```typescript
import { exportToCSV } from './schemaV1.js';

const csv = exportToCSV(rows);
// Returns RFC4180-compatible CSV string
```

**CSV Features:**
- Properly escaped values (commas, newlines, quotes)
- Fixed header order
- RFC4180 compliant
- No external dependencies

### JSON Export

```typescript
import { exportToJSON } from './schemaV1.js';

const json = exportToJSON(rows);
// Returns JSON string with metadata wrapper
```

**JSON Structure:**
```json
{
  "metadata": {
    "total_rows": 50,
    "exported_rows": 50,
    "export_tier": "demo",
    "truncated": true,
    "exported_at": "2024-01-15T10:30:00.000Z",
    "schema_version": "v1"
  },
  "rows": [
    // ... ExportRowV1 objects
  ]
}
```

## Tier Enforcement

- **Demo Tier**: Maximum 50 rows, `is_truncated` set to `true` if more data available
- **Paid Tier**: Unlimited rows, `is_truncated` always `false`

Enforcement happens in `buildExportRows()` - no need to check limits elsewhere.

## Data Aggregation

The export functions expect `BusinessExportData[]` which includes:
- Business information
- Industry/category
- City and country
- Website information
- Contacts (emails, phones, social links)
- Crawl information

See `exportHelpers.ts` for helper functions to aggregate this data.

## Logging

All functions log their operations:
- `[buildExportRows]` - Processing information
- `[exportToCSV]` - CSV generation stats
- `[exportToJSON]` - JSON generation stats

## Type Safety

All types are strictly defined:
- `ExportRowV1` - Exact schema interface
- `BusinessExportData` - Input data structure
- `ExportTier` - "demo" | "paid"

Use `isValidExportRow()` to validate rows at runtime if needed.

## Examples

See `schemaV1.example.ts` for complete usage examples including:
- CSV export example
- JSON export example
- Demo tier enforcement example

## Notes

- Empty values are normalized to empty strings (not null)
- Dates are formatted as ISO 8601 strings
- Boolean values are exported as "true"/"false" strings
- All numeric values are converted to strings for CSV compatibility
- Row numbers start at 1
- `is_truncated` is set per-row (all rows have same value)
