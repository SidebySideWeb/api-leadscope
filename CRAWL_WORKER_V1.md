# Crawl Worker v1

Production-ready website crawler with automatic fallback to local file storage when database is unavailable.

## Features

- **No Redis/Heavy Infrastructure**: Pure Node.js with in-memory concurrency control
- **Automatic Fallback**: Works with or without Supabase/PostgreSQL
- **Safe Limits**: Configurable max pages, depth, timeouts, rate limiting
- **Contact Extraction**: Emails, phones, social links
- **Export Integration**: Compatible with Export Schema v1

## Architecture

### Persistence Abstraction

Two implementations:
1. **DbPersistence**: PostgreSQL via Supabase (when available)
2. **LocalPersistence**: JSON files in `./data/` directory (always available)

Automatic fallback: tries DB first, falls back to local if unavailable.

### Components

- **URL Utilities** (`src/crawl/url.ts`): Normalization, validation, domain matching
- **Fetcher** (`src/crawl/fetcher.ts`): Native fetch with timeouts and size limits
- **Parser** (`src/crawl/parser.ts`): HTML parsing with Cheerio, link extraction
- **Extractors** (`src/crawl/extractors.ts`): Email, phone, social link extraction
- **Worker** (`src/workers/crawlWorker.ts`): Orchestration and BFS crawling
- **Persistence** (`src/persistence/`): DB and local file storage

## Usage

### CLI

```bash
npm run crawl -- --dataset <uuid> [options]
```

**Options:**
- `--dataset <uuid>` (required): Dataset ID to crawl
- `--concurrency <n>`: Concurrent crawls (default: 3)
- `--max-pages <n>`: Max pages per domain (default: 15)
- `--depth <n>`: Max crawl depth (default: 2)

**Example:**
```bash
npm run crawl -- --dataset 123e4567-e89b-12d3-a456-426614174000 --concurrency 5 --max-pages 20
```

### Programmatic

```typescript
import { crawlDataset } from './workers/crawlWorker.js';

const summary = await crawlDataset('dataset-id', {
  maxPages: 15,
  maxDepth: 2,
  concurrency: 3,
  timeout: 12000,
  delayMs: 400
});
```

## Data Storage

### Database (when available)

Results stored in `crawl_results` table:
- One row per business
- JSONB columns for emails, phones, social, errors
- Array column for contact_pages

### Local Files (fallback)

Directory structure:
```
data/
  businesses_<datasetId>.json      # Business list
  crawls/
    <datasetId>/
      <businessId>.json            # Individual crawl result
      summary.json                 # Dataset summary
      index.json                   # Crawl status index
```

## Crawl Process

1. **Load Businesses**: From DB or local file
2. **Filter**: Only businesses with `website_url`
3. **Crawl Each**:
   - BFS crawl starting from homepage
   - Prioritize contact pages
   - Extract emails, phones, social links
   - Respect limits (pages, depth, timeout)
4. **Rate Limiting**: 400ms delay between requests per domain
5. **Persist**: Save to DB (if available) and local file

## Extraction Rules

### Emails
- Mailto links
- Regex patterns (including obfuscated: `name [at] domain [dot] com`)
- Normalized to lowercase
- Deduplicated

### Phones
- Tel links
- Greek patterns: +30, landlines (210-219), mobiles (69XXXXXXXX)
- Normalized to E.164 format

### Social Links
- Facebook, Instagram, LinkedIn, Twitter/X, YouTube
- Canonicalized to main profile URLs

## Safety Features

- **Max Pages**: 15 per domain (configurable)
- **Max Depth**: 2 levels (configurable)
- **Timeout**: 12 seconds per request
- **Size Limit**: 1.5MB max response
- **Rate Limiting**: 400ms delay between requests
- **Domain Restriction**: Only same-domain links
- **File Blocking**: PDFs, images, archives, etc.

## Integration with Export Schema v1

Use `crawlResultToExportData()` to convert crawl results to export format:

```typescript
import { crawlResultToExportData } from './exports/crawlIntegration.js';

const exportData = crawlResultToExportData(
  crawlResult,
  business,
  industry,
  city,
  country
);
```

## Dependencies

No additional dependencies required:
- `cheerio`: Already in package.json
- `fetch`: Native in Node.js 18+
- `fs/promises`: Native Node.js

## Database Migration

Run migration to create `crawl_results` table:

```bash
npm run migrate create_crawl_results_v1.sql
```

## Error Handling

- Individual crawl failures don't stop the process
- Errors stored in `CrawlResultV1.errors` array
- Summary includes error count and details

## Logging

All operations logged with `[crawlDataset]`, `[crawlBusiness]`, `[persistence]` prefixes.

Enable debug logging:
```bash
DEBUG=true npm run crawl -- --dataset <uuid>
```
