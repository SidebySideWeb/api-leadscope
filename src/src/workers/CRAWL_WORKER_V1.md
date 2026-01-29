# Crawl Worker v1

Production-ready crawl worker with pricing gate enforcement and contact extraction.

## Features

- ✅ **Pricing Gate Enforcement**: Automatically enforces plan limits (demo: 3 pages, starter: 15 pages, pro: unlimited)
- ✅ **Contact Extraction**: Extracts emails, phone numbers, and contact page URLs
- ✅ **Partial Results**: Stores partial results even if gated
- ✅ **Smart Filtering**: Skips blog posts, SEO pages, infinite links
- ✅ **Depth Limiting**: Max depth 2 to prevent infinite crawling
- ✅ **Same-Domain Only**: Only crawls pages from the same domain

## Responsibilities

- Fetch HTML pages
- Extract: emails, phone numbers, contact page URL
- Respect crawl depth limits from pricing gates
- Store partial results even if gated

## What It Does NOT Do

- ❌ Follow infinite links (max depth 2)
- ❌ Crawl blog posts (skips `/blog/`, `/news/`, etc.)
- ❌ Do SEO analysis
- ❌ Crawl external domains
- ❌ Crawl XML/RSS feeds

## Usage

### Programmatic

```typescript
import { crawlWorkerV1 } from './workers/crawlWorkerV1.js';

const result = await crawlWorkerV1({
  businessId: 123,
  datasetId: '123e4567-e89b-12d3-a456-426614174000',
  websiteUrl: 'https://example.com',
  userPlan: 'demo', // or 'starter', 'pro'
});

if (result.success) {
  console.log(`Crawled ${result.pages_visited} of ${result.pages_limit} pages`);
  console.log(`Emails found: ${result.emails_found}`);
  console.log(`Phones found: ${result.phones_found}`);
  console.log(`Contact pages: ${result.contact_pages_found}`);
  console.log(`Gated: ${result.gated}`);
  
  if (result.gated && result.upgrade_hint) {
    console.log(result.upgrade_hint);
  }
} else {
  console.error(result.error);
}
```

### CLI

```bash
npm run crawl:v1 -- <businessId> <datasetId> <websiteUrl> <userPlan>
```

Example:
```bash
npm run crawl:v1 -- 123 "123e4567-e89b-12d3-a456-426614174000" "https://example.com" demo
```

## Response Structure

```typescript
interface CrawlWorkerV1Result {
  success: boolean;
  business_id: number;
  dataset_id: string;
  website_url: string;
  pages_visited: number;  // Actual pages crawled
  pages_limit: number;     // Max pages allowed by plan
  gated: boolean;          // True if limited by plan
  crawl_status: 'not_crawled' | 'partial' | 'completed';
  emails_found: number;
  phones_found: number;
  contact_pages_found: number;
  error?: string;          // Error if failed
  upgrade_hint?: string;   // Upgrade suggestion if gated
}
```

## Pricing Gate Rules

| Plan | Max Pages | Behavior |
|------|-----------|----------|
| **demo** | 3 | Crawls first 3 pages, `gated: true` if more available |
| **starter** | 15 | Crawls first 15 pages, `gated: true` if more available |
| **pro** | Unlimited | Crawls all pages (up to depth 2), `gated: false` |

## Crawl Behavior

### Depth Limiting
- **Max Depth**: 2 levels
- Prevents infinite link following
- Homepage = depth 0, links from homepage = depth 1, etc.

### URL Filtering
Skips URLs matching these patterns:
- `/blog/`, `/news/`, `/articles/`
- `/category/`, `/tag/`, `/author/`
- `/archive/`, `/search/`, `/sitemap`
- `.xml`, `.rss`, `.json`
- `/feed/`

### Contact Page Detection
Detects contact pages by:
- URL patterns: `/contact`, `/contact-us`, `/επικοινωνια`, etc.
- Anchor text: "contact", "about", "team", etc.

### Extraction
- **Emails**: From mailto links and text (including obfuscated)
- **Phones**: From tel links and text (Greek format normalized to +30)
- **Social Links**: Facebook, Instagram, LinkedIn, Twitter, YouTube (from homepage only)

## Data Storage

Results are stored in the `crawl_results` table:
- `business_id`: UUID (converted from integer)
- `dataset_id`: UUID
- `website_url`: Normalized URL
- `pages_visited`: Number of pages crawled
- `crawl_status`: 'not_crawled' | 'partial' | 'completed'
- `emails`: JSONB array of `{value, source_url, context?}`
- `phones`: JSONB array of `{value, source_url}`
- `contact_pages`: TEXT array of URLs
- `social`: JSONB object with social links
- `errors`: JSONB array of `{url, message}`

## Error Handling

The worker **always stores partial results**:
- If crawl is gated: stores what was found, sets `crawl_status: 'partial'`
- If errors occur: stores successful extractions, includes errors in `errors` array
- Never throws errors for limits (graceful degradation)

## Rate Limiting

- 400ms delay between requests (except first)
- 12 second timeout per page
- 1.5MB max response size

## Notes

- Business ID is converted from integer to UUID format for database storage
- Social links are only extracted from homepage (depth 0)
- Contact pages are detected both by URL pattern and anchor text
- All results are deduplicated (emails, phones, contact pages)
