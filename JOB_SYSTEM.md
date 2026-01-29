# Discovery & Refresh Job System

## Overview

The system implements two distinct job types for business intelligence data management:

1. **Discovery Jobs** - Ad-hoc, paid discovery requests
2. **Refresh Jobs** - Recurring, subscription-based data refreshes

These job types are **completely separate** and must never be mixed.

## Job Types

### Discovery Jobs

**Purpose:** Create new business data from scratch

**Characteristics:**
- Triggered manually (client request)
- Uses geo-grid discovery
- Calls Google Places API
- Creates new businesses and websites
- Does NOT update existing contacts
- Does NOT mark removals
- Does NOT deactivate anything

**Use Case:** Initial data collection for a new city/industry

### Refresh Jobs

**Purpose:** Update existing data and track changes

**Characteristics:**
- Triggered monthly (cron schedule)
- NO Google Places API usage
- NO geo-grid scanning
- Only re-crawls known websites
- Updates contact lifecycle status
- Tracks contact changes (added/verified/deactivated)
- Never deletes contacts

**Use Case:** Monthly subscription refresh to keep data current

## Database Schema

### Extended Tables

#### `crawl_jobs`
```sql
ALTER TABLE crawl_jobs
ADD COLUMN job_type VARCHAR(20) DEFAULT 'discovery'
  CHECK (job_type IN ('discovery', 'refresh'));
```

#### `contacts`
```sql
ALTER TABLE contacts
ADD COLUMN first_seen_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN last_verified_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
```

## Usage

### Discovery Job

**CLI:**
```bash
npm run discover "restaurant" "Athens" --geo-grid
```

**Programmatic:**
```typescript
import { runDiscoveryJob } from './services/discoveryService.js';

const result = await runDiscoveryJob({
  industry: 'restaurant',
  city: 'Athens',
  useGeoGrid: true
});
```

### Refresh Job

**CLI:**
```bash
# Run refresh job manually
npm run refresh [batchSize] [maxAgeDays]

# Example: Process 50 websites older than 30 days
npm run refresh 50 30
```

**Programmatic:**
```typescript
import { runRefreshJob } from './services/refreshService.js';

const result = await runRefreshJob({
  batchSize: 50,
  maxAgeDays: 30
});
```

### Scheduler

**Start monthly scheduler:**
```bash
npm run scheduler:start
```

The scheduler runs automatically on the **1st of every month at 2:00 AM**.

## Change Detection

### Contact Matching

Contacts are matched by:
- **Type** (email / phone / mobile)
- **Normalized value** (lowercase email, +30 phone format)
- **Business ID** (links contact to specific business)

### Change Actions

1. **Added** - New contact found
   - `first_seen_at` = NOW()
   - `last_verified_at` = NOW()
   - `is_active` = TRUE
   - Creates new `contact_sources` record

2. **Verified** - Existing contact still present
   - `last_verified_at` = NOW()
   - `is_active` = TRUE

3. **Deactivated** - Contact no longer found
   - `is_active` = FALSE
   - Contact preserved (never deleted)
   - Source records preserved

## Job Results

Both job types return a `JobResult`:

```typescript
interface JobResult {
  jobId: string;
  jobType: 'discovery' | 'refresh';
  startTime: Date;
  endTime: Date;
  totalWebsitesProcessed: number;
  contactsAdded: number;
  contactsRemoved: number; // Only for refresh
  contactsVerified: number; // Only for refresh
  errors: string[];
}
```

## Legal Compliance

- ✅ `contact_sources` table preserved
- ✅ `source_url` remains unchanged
- ✅ New contacts create new source rows
- ✅ No personal enrichment
- ✅ No scraping outside public pages
- ✅ Contacts never deleted (only deactivated)

## Architecture

### File Structure

```
src/
  /jobs
    discoveryJob.ts      # Discovery job handler
    refreshJob.ts        # Refresh job handler
  
  /services
    discoveryService.ts  # Discovery logic
    refreshService.ts   # Refresh logic
    changeDetector.ts   # Change detection
  
  /scheduler
    refreshScheduler.ts # Monthly scheduler
  
  /utils
    contactComparator.ts # Contact matching utilities
```

### Services

#### `discoveryService.ts`
- Runs geo-grid discovery
- Creates businesses and websites
- Creates crawl jobs (type: 'discovery')
- Does NOT touch existing contacts

#### `refreshService.ts`
- Selects websites needing refresh
- Re-crawls websites
- Extracts contacts
- Detects changes
- Updates contact lifecycle

#### `changeDetector.ts`
- Matches contacts by normalized values
- Detects additions/verifications/deactivations
- Updates contact status
- Preserves source provenance

## Migration

Run migrations to add required columns:

```bash
# Add job_type to crawl_jobs
npm run migrate:job-types

# Or manually
npm run migrate add_job_types.sql
```

## Monitoring

### Logging

Each job logs:
- Job ID and type
- Start/end time
- Websites processed
- Contacts added/verified/deactivated
- Errors

### Example Log Output

```
🔍 Starting DISCOVERY job: discovery-1234567890-abc123
   Industry: restaurant
   City: Athens
   Use Geo-Grid: true

✅ DISCOVERY job completed: discovery-1234567890-abc123
   Duration: 245.3s
   Businesses found: 1,234
   Businesses created: 856
   Websites created: 623
   Crawl jobs created: 623
```

```
🔄 Starting REFRESH job: refresh-1234567890-xyz789
   Batch size: 50
   Max age: 30 days
   Found 45 websites to refresh

✅ REFRESH job completed: refresh-1234567890-xyz789
   Duration: 123.5s
   Websites processed: 45
   Contacts added: 12
   Contacts verified: 234
   Contacts deactivated: 8
```

## Best Practices

1. **Never mix job types** - Discovery and refresh are separate
2. **Run refresh monthly** - Use scheduler for consistency
3. **Monitor contact lifecycle** - Track `is_active` and `last_verified_at`
4. **Preserve history** - Never delete contacts or sources
5. **Batch processing** - Use appropriate batch sizes for refresh
6. **Error handling** - Jobs continue on partial failures

## Future Enhancements

- [ ] Job queue system for discovery jobs
- [ ] Webhook notifications on job completion
- [ ] Dashboard for job monitoring
- [ ] Automatic retry for failed refresh jobs
- [ ] Contact re-activation if found again
