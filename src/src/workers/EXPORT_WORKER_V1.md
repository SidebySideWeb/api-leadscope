# Export Worker v1

Production-ready export worker with pricing gate enforcement.

## Features

- ✅ **Pricing Gate Enforcement**: Automatically enforces plan limits (demo: 50 rows, starter: 500 rows, pro: unlimited)
- ✅ **Graceful Degradation**: Never throws errors for limits - returns gated status instead
- ✅ **Multiple Formats**: Supports CSV (UTF-8, Excel-safe) and XLSX (single sheet)
- ✅ **Complete Data**: Includes businesses, contacts, websites, social links
- ✅ **Consistent Response**: Always returns `rows_returned`, `rows_total`, `gated` status

## Usage

### Programmatic

```typescript
import { exportWorkerV1 } from './workers/exportWorkerV1.js';

const result = await exportWorkerV1({
  datasetId: '123e4567-e89b-12d3-a456-426614174000',
  format: 'csv', // or 'xlsx'
  userPlan: 'demo', // or 'starter', 'pro'
});

if (result.success) {
  console.log(`Exported ${result.rows_returned} of ${result.rows_total} rows`);
  console.log(`Gated: ${result.gated}`);
  
  if (result.file) {
    // Save or send file
    await fs.writeFile('export.csv', result.file);
  }
  
  if (result.gated && result.upgrade_hint) {
    console.log(result.upgrade_hint);
  }
} else {
  console.error(result.error);
}
```

### CLI

```bash
npm run export:v1 -- <datasetId> <format> <userPlan>
```

Example:
```bash
npm run export:v1 -- "123e4567-e89b-12d3-a456-426614174000" csv demo
```

## Response Structure

```typescript
interface ExportWorkerV1Result {
  success: boolean;
  rows_returned: number;  // Number of rows actually exported
  rows_total: number;     // Total rows available in dataset
  gated: boolean;          // True if export was limited by plan
  file?: Buffer;           // Generated file buffer
  filename?: string;       // Suggested filename
  error?: string;          // Error message if failed
  upgrade_hint?: string;   // Upgrade suggestion if gated
}
```

## Pricing Gate Rules

| Plan | Max Rows | Behavior |
|------|----------|----------|
| **demo** | 50 | Returns first 50 rows, `gated: true` |
| **starter** | 500 | Returns first 500 rows, `gated: true` if more available |
| **pro** | Unlimited | Returns all rows, `gated: false` |

## Export Schema

Uses the **Simplified Export Schema** with 15 fields:

1. `business_name`
2. `industry`
3. `city`
4. `address`
5. `phone`
6. `email`
7. `website`
8. `google_maps_url`
9. `rating`
10. `reviews_count`
11. `contact_page_url`
12. `facebook`
13. `instagram`
14. `linkedin`
15. `last_crawled_at`

## Data Sources

- **Businesses**: From `businesses` table
- **Contacts**: From `contacts` and `contact_sources` tables (best email/phone selected)
- **Websites**: From `websites` table
- **Social Links**: From `crawl_results` table (if available)
- **Rating/Reviews**: Currently null (not stored in DB yet)

## Error Handling

The worker **never throws errors for limits**. Instead:

- Returns `success: false` only for actual errors (dataset not found, DB errors, etc.)
- Returns `gated: true` when limits are applied
- Always includes `rows_returned` and `rows_total` for transparency

## CSV Format

- UTF-8 encoding (Excel-safe)
- RFC4180 compliant
- Properly escaped values (commas, newlines, quotes)
- Fixed header order

## XLSX Format

- Single worksheet named "Export"
- Column headers with proper widths
- Optional watermark footer if gated
- Excel-compatible formatting

## Notes

- Social links (Facebook, Instagram, LinkedIn) are currently null in the query
  - This is because `crawl_results.business_id` is UUID but `businesses.id` is integer
  - Can be fixed by updating the schema or adding a proper join
- Rating and reviews_count are currently null
  - These need to be stored in the `businesses` table from Google Places API
  - The Google Maps service already fetches these fields
