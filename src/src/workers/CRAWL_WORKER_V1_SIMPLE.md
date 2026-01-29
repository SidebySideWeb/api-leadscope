# Crawl Worker v1 - Simple Version

Simplified crawl worker that crawls business websites and extracts contact information.

## Overview

- **Input**: Business with `id` and `website`, plus `maxDepth`
- **Behavior**: Crawls homepage, follows contact-related links, extracts contacts
- **Output**: Saves contacts to local dataset store
- **Constraints**: No Redis, no queues, uses fetch, 10s timeout per page

## Features

- ✅ **Homepage Crawl**: Always crawls homepage first
- ✅ **Contact Link Following**: Follows links containing "contact", "about", "επικοινωνία"
- ✅ **Depth Control**: Stops at `maxDepth`
- ✅ **Contact Extraction**: Extracts emails, phone numbers, social links
- ✅ **Deduplication**: Deduplicates all results
- ✅ **Local Storage**: Saves to local dataset store (no database)

## Usage

```typescript
import { crawlWorkerV1Simple } from './workers/crawlWorkerV1Simple.js';

const result = await crawlWorkerV1Simple({
  business: {
    id: 123,
    website: 'https://example.com',
  },
  maxDepth: 2,
  datasetId: 'dataset-uuid',
});

console.log(`Crawled ${result.pages_crawled} pages`);
console.log(`Found ${result.emails_found} emails, ${result.phones_found} phones`);
console.log(`Saved ${result.contacts_saved} contacts`);
```

## Input

```typescript
interface CrawlWorkerV1SimpleInput {
  business: {
    id: number;
    website: string;
  };
  maxDepth: number;
  datasetId: string; // For saving to local store
}
```

## Output

```typescript
interface CrawlWorkerV1SimpleResult {
  success: boolean;
  business_id: number;
  website_url: string;
  pages_crawled: number;
  emails_found: number;
  phones_found: number;
  social_links_found: number;
  contacts_saved: number;
  error?: string;
}
```

## Crawl Behavior

### Starting Point

- Always starts with homepage (depth 0)

### Link Following

Only follows links that:
- Contain keywords: "contact", "about", "επικοινωνία" (Greek: contact)
- Are on the same domain (internal links only)
- Are not already visited
- Are within `maxDepth` limit

### Extraction

**Emails**:
- Extracted from `mailto:` links
- Extracted from page text (regex patterns)
- Handles obfuscated emails
- Deduplicated by email value

**Phones**:
- Extracted from `tel:` links
- Extracted from page text (Greek + international patterns)
- Normalized to E.164 format (+30XXXXXXXXX)
- Deduplicated by phone value
- Classified as phone or mobile (Greek mobiles start with 69)

**Social Links**:
- Extracted only from homepage (depth 0)
- Supports: Facebook, Instagram, LinkedIn, Twitter, YouTube
- Canonicalized URLs

### Deduplication

- **Emails**: Deduplicated by email value
- **Phones**: Deduplicated by phone value
- **Contacts**: Deduplicated by contact key (`email:value` or `phone:value`)

### Storage

Contacts are saved to local dataset store:
- Path: `/data/datasets/{datasetId}/contacts.json`
- Format: Array of `Contact` objects
- Auto-creates directory if needed

## Example

```typescript
// Crawl a business website
const result = await crawlWorkerV1Simple({
  business: {
    id: 1,
    website: 'https://example.com',
  },
  maxDepth: 2,
  datasetId: 'abc-123-def',
});

if (result.success) {
  console.log(`✅ Crawled ${result.pages_crawled} pages`);
  console.log(`   Emails: ${result.emails_found}`);
  console.log(`   Phones: ${result.phones_found}`);
  console.log(`   Social: ${result.social_links_found}`);
  console.log(`   Saved: ${result.contacts_saved} contacts`);
} else {
  console.error(`❌ Crawl failed: ${result.error}`);
}
```

## Crawl Flow

1. **Normalize URL**: Convert to https, validate
2. **Start Queue**: Add homepage to queue (depth 0)
3. **BFS Crawl**:
   - Fetch page (10s timeout)
   - Extract emails, phones, social links
   - Find contact-related links
   - Add to queue if within depth limit
4. **Deduplicate**: Remove duplicate emails/phones
5. **Convert to Contacts**: Create Contact objects
6. **Save**: Write to local dataset store

## Contact Keywords

The worker follows links containing:
- **English**: "contact", "about"
- **Greek**: "επικοινωνία" (contact), "επικοινωνια" (without accent)

## Timeout

- **Per Page**: 10 seconds
- **Behavior**: Skips page if timeout, continues with next URL

## Error Handling

- **Invalid URL**: Returns error immediately
- **HTTP Errors**: Logs warning, continues with next URL
- **Fetch Errors**: Logs warning, continues with next URL
- **Save Errors**: Returns error in result

## Rate Limiting

- **Delay**: 400ms between requests
- **Purpose**: Avoid overwhelming target server

## Limitations

- **No Redis**: No distributed queue
- **No Queues**: Single-process execution
- **No Database**: Uses local filesystem only
- **No Retries**: Failed pages are skipped
- **No Robots.txt**: Doesn't check robots.txt (can be added)

## Future Enhancements

- Add robots.txt checking
- Add retry logic for failed pages
- Add crawl statistics (time taken, etc.)
- Add support for more contact keywords
- Add support for more social platforms
