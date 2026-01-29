# Global Safety Limits

Hard limits that cannot be overridden by plan tiers. These are safety caps to prevent resource exhaustion and abuse.

## Limits

### `MAX_PAGES_PER_CRAWL = 50`

Maximum number of pages that can be crawled in a single crawl operation. This is a hard limit that applies regardless of plan tier.

**Enforcement:**
- Checked before plan-based limits
- If exceeded: crawl stops gracefully, marked as `partial`, not retried

### `MAX_CONCURRENT_CRAWLS = 1`

Maximum number of crawls that can run simultaneously. Only one crawl can run at a time.

**Enforcement:**
- Uses semaphore pattern with queue
- Crawls wait in queue if slot unavailable
- Slot automatically released when crawl completes

### `CRAWL_TIMEOUT_MS = 60000` (60 seconds)

Maximum time allowed for a single crawl operation. If exceeded, crawl stops gracefully.

**Enforcement:**
- Checked during crawl loop
- If exceeded: crawl stops immediately, marked as `partial`, not retried
- Error message added to crawl result

## Behavior When Limits Exceeded

### Pages Limit Exceeded

- **Action**: Stop crawl gracefully
- **Status**: Mark as `partial`
- **Retry**: Do not retry
- **Error**: Added to errors array

### Timeout Exceeded

- **Action**: Stop crawl immediately
- **Status**: Mark as `partial`
- **Retry**: Do not retry
- **Error**: "Safety limit: Crawl timeout exceeded (60000ms)"
- **Success**: `success: false` in result

### Concurrency Limit

- **Action**: Wait in queue until slot available
- **Status**: Crawl proceeds normally once slot acquired
- **Retry**: Not applicable (queue handles waiting)

## Implementation

### Safety Limits Module

```typescript
import { 
  MAX_PAGES_PER_CRAWL, 
  CRAWL_TIMEOUT_MS,
  applySafetyCaps 
} from '../limits/safetyLimits.js';
```

### Concurrency Control

```typescript
import { acquireCrawlSlot } from '../workers/crawlConcurrency.js';

// Acquire slot before crawl
const releaseCrawlSlot = await acquireCrawlSlot();

try {
  // Perform crawl...
} finally {
  // Always release slot
  releaseCrawlSlot();
}
```

### Usage in Crawl Worker

1. **Acquire crawl slot** (enforces MAX_CONCURRENT_CRAWLS)
2. **Apply safety caps** (enforces MAX_PAGES_PER_CRAWL)
3. **Check timeout during crawl** (enforces CRAWL_TIMEOUT_MS)
4. **Mark as partial if limits exceeded**
5. **Do not retry** if safety limits exceeded

## Priority

Safety limits are checked **BEFORE** plan-based limits:

1. Safety limits (hard caps)
2. Plan-based limits (tier-specific)
3. Usage limits (monthly quotas)

This ensures safety limits cannot be bypassed by upgrading plans.

## Examples

### Example 1: Pages Limit

```typescript
// User requests 100 pages
const requestedPages = 100;

// Safety cap applies
const safetyCaps = applySafetyCaps({ maxPages: requestedPages });
// Result: maxPages = 50 (capped at MAX_PAGES_PER_CRAWL)

// Crawl stops at 50 pages, marked as 'partial'
```

### Example 2: Timeout

```typescript
// Crawl starts
const crawlStartTime = Date.now();

// During crawl loop
const elapsed = Date.now() - crawlStartTime;
if (elapsed >= CRAWL_TIMEOUT_MS) {
  // Stop immediately, mark as 'partial'
  break;
}
```

### Example 3: Concurrency

```typescript
// First crawl starts
const release1 = await acquireCrawlSlot(); // activeCrawls = 1

// Second crawl waits
const release2 = await acquireCrawlSlot(); // Queued, waits

// First crawl completes
release1(); // activeCrawls = 0, release2 now proceeds
```

## Error Messages

When safety limits are exceeded, clear error messages are provided:

- **Pages**: "Safety limit: Maximum 50 pages per crawl (requested: X)"
- **Timeout**: "Safety limit: Crawl timeout exceeded (60000ms)"
- **Concurrency**: Handled transparently via queue

## Logging

Safety limit violations are logged:

```typescript
console.warn(`[crawlWorkerV1] ${safetyLimitReason} for ${websiteUrl}`);
```

## Testing

To test safety limits:

1. **Pages limit**: Request crawl with >50 pages
2. **Timeout**: Simulate slow crawl (>60s)
3. **Concurrency**: Start multiple crawls simultaneously

All should gracefully stop and mark as `partial` without retrying.
