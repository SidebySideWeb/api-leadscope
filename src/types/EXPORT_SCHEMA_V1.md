# Export Schema v1 - Canonical Types

## Overview

Export Schema v1 provides a **single source of truth** for export row structure used across:
- Dashboard tables/lists (businesses + contacts)
- Export worker (CSV/XLSX generation)
- API responses

## Types

### `ExportRowV1`

Canonical export row structure with all business and contact information.

```typescript
interface ExportRowV1 {
  // Identifiers
  dataset_id: string; // UUID
  business_id: string; // UUID or number (converted to string)
  
  // Business information
  business_name: string;
  business_address: string | null;
  city: string;
  industry: string | null;
  
  // Website
  website_url: string | null;
  
  // Contact information (arrays for multiple values)
  emails: string[]; // Array of email addresses found
  phones: string[]; // Array of phone numbers found
  
  // Social links
  social: {
    facebook?: string | null;
    instagram?: string | null;
    linkedin?: string | null;
    tiktok?: string | null;
    youtube?: string | null;
    x?: string | null; // Twitter/X
    website?: string | null;
  };
  
  // Source pages (where contacts were found)
  source_pages?: Array<{
    url: string;
    page_type: 'homepage' | 'contact' | 'about' | 'company' | 'footer';
    found_at: string; // ISO 8601 date string
  }>;
  
  // Crawl information
  last_crawled_at: string | null; // ISO 8601 date string or null
  crawl_status: 'not_crawled' | 'partial' | 'completed';
  pages_visited: number;
}
```

### `ExportMetaV1`

Response metadata for export operations, indicating plan limits and gating.

```typescript
interface ExportMetaV1 {
  plan_id: 'demo' | 'starter' | 'pro';
  gated: boolean; // Whether export was limited by plan
  total_available: number; // Total rows available (before limits)
  total_returned: number; // Rows actually returned (after limits)
  watermark?: string; // Watermark text for gated exports
  gate_reason?: string; // Reason for gating (if gated)
  upgrade_hint?: string; // Upgrade suggestion (if gated)
}
```

### `ExportPayloadV1`

Complete export response structure.

```typescript
interface ExportPayloadV1 {
  rows: ExportRowV1[];
  meta: ExportMetaV1;
}
```

## Mapping Function

### `mapBusinessAndCrawlResultToExportRow()`

Maps a `Business` + optional `CrawlResultV1` to `ExportRowV1`.

**Key Features:**
- Tolerates missing crawl results (sets `crawl_status = 'not_crawled'`)
- Extracts emails and phones from crawl result
- Builds source pages array from crawl result
- Handles social links (maps `twitter` to `x`)
- Deduplicates source pages by URL

**Usage:**

```typescript
import { mapBusinessAndCrawlResultToExportRow } from './types/export.js';

const exportRow = mapBusinessAndCrawlResultToExportRow({
  business: myBusiness,
  industry: { name: 'Technology' },
  city: { name: 'Athens' },
  crawlResult: myCrawlResult, // Optional - handles null
});
```

## Type Guards

### `isValidExportRowV1()`

Type guard to validate an object is a valid `ExportRowV1`.

```typescript
if (isValidExportRowV1(row)) {
  // row is typed as ExportRowV1
}
```

### `assertExportRowV1()`

Assertion helper for type checking in tests.

```typescript
assertExportRowV1(row); // Throws if invalid
```

## Integration Points

### Dashboard Tables

Use `ExportRowV1` for displaying business lists with contact information.

### Export Worker

Convert `ExportRowV1[]` to CSV/XLSX format using the canonical structure.

### API Responses

Return `ExportPayloadV1` with rows and metadata for consistent API responses.

## Plan ID Consistency

All plan identifiers use the shared `PlanId` type:

```typescript
type PlanId = 'demo' | 'starter' | 'pro';
```

This ensures consistency between:
- Backend permissions (`src/db/permissions.ts`)
- Frontend types (`lead-scope-ai-dashboard/lib/types.ts`)
- Export metadata (`ExportMetaV1`)

## Response Metadata Consistency

All API responses use `ResponseMeta` from `src/types/response.ts`:

```typescript
interface ResponseMeta {
  plan_id: PlanId;
  gated: boolean;
  gate_reason?: string;
  total_available: number;
  total_returned: number;
  upgrade_hint?: string;
}
```

This ensures the frontend and backend agree on response structure.

## Examples

See `src/types/export.test.ts` for complete examples including:
- Business with crawl result
- Business without crawl result (not_crawled)
- Export payload with metadata
- Type guard tests
