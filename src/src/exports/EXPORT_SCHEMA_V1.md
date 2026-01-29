# Export Schema v1

Simple export schema with CSV output and demo limit enforcement.

## Requirements

- **CSV output**: RFC4180 compatible CSV format
- **Columns**: business_name, website, email, phone, source_page, confidence
- **Demo limit**: Enforces 50 rows maximum for demo plan
- **File location**: Saves under dataset folder (`/data/datasets/{datasetId}/export-{timestamp}.csv`)

## Schema

### ExportRowV1

```typescript
interface ExportRowV1 {
  business_name: string;
  website: string;
  email: string;
  phone: string;
  source_page: string;
  confidence: string; // Number as string (0-1)
}
```

### BusinessExportInput

```typescript
interface BusinessExportInput {
  business: {
    name: string;
  };
  website: {
    url: string;
  } | null;
  contact: {
    email: string | null;
    phone: string | null;
    source_url: string;
    confidence?: number;
  } | null;
}
```

## Usage

### Complete Export Workflow

```typescript
import { exportDatasetV1, type BusinessExportInput, type Plan } from './exportSchemaV1.js';

const businesses: BusinessExportInput[] = [
  {
    business: { name: 'Acme Corp' },
    website: { url: 'https://acme.com' },
    contact: {
      email: 'info@acme.com',
      phone: '+302101234567',
      source_url: 'https://acme.com/contact',
      confidence: 0.9,
    },
  },
];

const result = await exportDatasetV1(businesses, 'demo', 'dataset-uuid');

if (result.success) {
  console.log(`Exported ${result.rows_exported} rows to ${result.filePath}`);
}
```

### Step-by-Step

```typescript
import { 
  buildExportRowsV1, 
  exportToCSVV1, 
  saveExportFileV1 
} from './exportSchemaV1.js';

// 1. Build rows (enforces limit)
const rows = buildExportRowsV1(businesses, 'demo');

// 2. Generate CSV
const csv = exportToCSVV1(rows);

// 3. Save to dataset folder
const filePath = await saveExportFileV1('dataset-uuid', csv);
```

## Demo Limit Enforcement

The export automatically enforces the demo limit (50 rows) using pricing gates:

- **Demo plan**: Maximum 50 rows (truncated if exceeded)
- **Paid plan**: Unlimited rows

```typescript
// Demo plan: truncates to 50 rows
const demoRows = buildExportRowsV1(businesses, 'demo'); // Max 50

// Paid plan: no truncation
const paidRows = buildExportRowsV1(businesses, 'paid'); // All rows
```

## CSV Format

### Headers

```
business_name,website,email,phone,source_page,confidence
```

### Example Row

```
Acme Corp,https://acme.com,info@acme.com,+302101234567,https://acme.com/contact,0.9
```

### RFC4180 Compliance

- Fields containing commas, newlines, or quotes are wrapped in double quotes
- Double quotes within fields are escaped as `""`
- UTF-8 encoding

## File Location

Exports are saved to:

```
/data/datasets/{datasetId}/export-{timestamp}.csv
```

Example:

```
/data/datasets/abc-123-def/export-2025-01-27T21-30-00-000Z.csv
```

## Error Handling

The export functions handle errors gracefully:

```typescript
const result = await exportDatasetV1(businesses, 'demo', 'dataset-uuid');

if (!result.success) {
  console.error(`Export failed: ${result.error}`);
}
```

## Integration with Pricing Gates

The export schema uses the shared `pricing.ts` module for limit enforcement:

- `assertExport(plan, rowCount)` - Throws if limit exceeded
- `getExportLimit(plan)` - Returns limit for plan

This ensures consistent limit enforcement across the application.
