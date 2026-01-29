# Structured Action Logging

All actions are logged as JSON to stdout with consistent structure.

## Log Format

Every action log includes:

```json
{
  "timestamp": "2025-01-15T10:30:45.123Z",
  "user_id": "user-uuid",
  "action": "export" | "crawl" | "discovery" | "refresh" | "usage_increment",
  "dataset_id": "dataset-uuid" | null,
  "result_summary": "Human-readable summary of the action result",
  "gated": true | false,
  "error": "Error message" | null,
  "metadata": {
    // Additional context specific to action type
  }
}
```

## Actions Logged

### Export Actions

**Action Type**: `export`

**Logged When**:
- Export starts (usage limit check)
- Export completes successfully
- Export fails (dataset not found, errors)

**Example**:
```json
{
  "timestamp": "2025-01-15T10:30:45.123Z",
  "user_id": "user-123",
  "action": "export",
  "dataset_id": "dataset-456",
  "result_summary": "Export completed: 50 of 100 rows exported (format: xlsx)",
  "gated": true,
  "error": null,
  "metadata": {
    "format": "xlsx",
    "rows_returned": 50,
    "rows_total": 100,
    "upgrade_hint": "Upgrade to Pro plan for unlimited exports."
  }
}
```

### Crawl Actions

**Action Type**: `crawl`

**Logged When**:
- Crawl starts (usage limit check)
- Crawl completes (success, partial, or failed)
- Crawl fails with error

**Example**:
```json
{
  "timestamp": "2025-01-15T10:30:45.123Z",
  "user_id": "user-123",
  "action": "crawl",
  "dataset_id": "dataset-456",
  "result_summary": "Crawl partial: 25 pages visited, 10 emails, 5 phones found",
  "gated": true,
  "error": null,
  "metadata": {
    "business_id": 789,
    "website_url": "https://example.com",
    "pages_visited": 25,
    "pages_limit": 50,
    "crawl_status": "partial",
    "emails_found": 10,
    "phones_found": 5,
    "contact_pages_found": 2,
    "errors_count": 0,
    "hit_timeout": false,
    "hit_page_limit": true,
    "upgrade_hint": "Upgrade to Pro plan for crawl depth up to 10."
  }
}
```

### Discovery Actions

**Action Type**: `discovery`

**Logged When**:
- Discovery starts (usage limit check)
- Discovery completes successfully
- Discovery fails with error

**Example**:
```json
{
  "timestamp": "2025-01-15T10:30:45.123Z",
  "user_id": "user-123",
  "action": "discovery",
  "dataset_id": "dataset-456",
  "result_summary": "Discovery completed: 50 businesses found, 45 created, 40 websites, 35 crawl jobs created",
  "gated": false,
  "error": null,
  "metadata": {
    "job_id": "discovery-1234567890-abc123",
    "industry": "Restaurants",
    "city": "Athens",
    "businesses_found": 50,
    "businesses_created": 45,
    "websites_created": 40,
    "crawl_jobs_created": 35,
    "duration_seconds": 12.5,
    "is_reused": false,
    "upgrade_hint": null
  }
}
```

### Usage Increment Actions

**Action Type**: `usage_increment`

**Logged When**:
- Usage counter is incremented (export, crawl, or dataset creation)

**Example**:
```json
{
  "timestamp": "2025-01-15T10:30:45.123Z",
  "user_id": "user-123",
  "action": "usage_increment",
  "dataset_id": null,
  "result_summary": "Usage incremented: export count is now 3 for month 2025-01",
  "gated": false,
  "error": null,
  "metadata": {
    "usage_type": "export",
    "month_year": "2025-01",
    "exports_this_month": 3,
    "crawls_this_month": 5,
    "datasets_created_this_month": 1
  }
}
```

## Output

All logs are written to **stdout** as single-line JSON. This allows:

- Easy parsing by log aggregation tools (e.g., ELK, Datadog, CloudWatch)
- Piping to `jq` for filtering: `npm run crawl | jq 'select(.action == "crawl")'`
- Redirecting to files: `npm run crawl > crawl.log 2>&1`
- Integration with log shippers

## Usage

### In Workers

```typescript
import { logExportAction, logCrawlAction, logDiscoveryAction } from '../utils/actionLogger.js';

// Log export
logExportAction({
  userId: 'user-123',
  datasetId: 'dataset-456',
  resultSummary: 'Export completed: 50 rows',
  gated: false,
  error: null,
  metadata: { format: 'xlsx', rows: 50 },
});

// Log crawl
logCrawlAction({
  userId: 'user-123',
  datasetId: 'dataset-456',
  resultSummary: 'Crawl completed: 25 pages',
  gated: true,
  error: null,
  metadata: { pages_visited: 25, emails_found: 10 },
});

// Log discovery
logDiscoveryAction({
  userId: 'user-123',
  datasetId: 'dataset-456',
  resultSummary: 'Discovery completed: 50 businesses',
  gated: false,
  error: null,
  metadata: { businesses_found: 50 },
});
```

## Integration Points

Logging is integrated into:

1. **Export Worker** (`src/workers/exportWorkerV1.ts`)
   - Usage limit exceeded
   - Dataset not found
   - Export completed
   - Export failed

2. **Crawl Worker** (`src/workers/crawlWorkerV1.ts`)
   - Usage limit exceeded
   - Crawl completed (success/partial/failed)
   - Crawl failed with error

3. **Discovery Service** (`src/services/discoveryService.ts`)
   - Usage limit exceeded
   - Discovery completed
   - Discovery failed

4. **Persistence Layer** (`src/persistence/index.ts`)
   - Usage increment (export, crawl, dataset)

## Benefits

- **Structured**: Consistent JSON format for all actions
- **Queryable**: Easy to filter and analyze with log tools
- **Complete**: Includes all relevant context (user, dataset, result, errors)
- **Non-blocking**: Logging doesn't affect action execution
- **Standard**: Uses stdout (standard logging practice)

## Example Output

```bash
$ npm run crawl -- --dataset abc-123

{"timestamp":"2025-01-15T10:30:45.123Z","user_id":"user-123","action":"crawl","dataset_id":"abc-123","result_summary":"Crawl completed: 25 pages visited, 10 emails, 5 phones found","gated":false,"error":null,"metadata":{"business_id":789,"pages_visited":25,"emails_found":10}}
{"timestamp":"2025-01-15T10:30:46.456Z","user_id":"user-123","action":"usage_increment","dataset_id":null,"result_summary":"Usage incremented: crawl count is now 3 for month 2025-01","gated":false,"error":null,"metadata":{"usage_type":"crawl","month_year":"2025-01"}}
```

## Filtering Logs

### With jq

```bash
# All export actions
npm run export | jq 'select(.action == "export")'

# All gated actions
npm run crawl | jq 'select(.gated == true)'

# All errors
npm run discover | jq 'select(.error != null)'

# Actions for specific user
npm run export | jq 'select(.user_id == "user-123")'
```

### With grep

```bash
# All export actions
npm run export | grep '"action":"export"'

# All errors
npm run crawl | grep '"error":'
```
