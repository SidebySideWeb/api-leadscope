# Shared Business Intelligence Platform - Refactoring Guide

## Overview

This document describes the architectural refactoring to transform the lead-generation SaaS into a **shared business intelligence platform** where businesses are global, reusable assets rather than dataset-owned records.

## Core Architectural Changes

### 1. Business Entity Upgrade ✅

**Migration:** `src/db/migrations/upgrade_businesses_to_shared_assets.sql`

**New Fields Added:**
- `latitude`, `longitude` - Business location
- `website`, `phone` - Primary contact info (denormalized for performance)
- `emails` (JSONB) - Array of email addresses
- `social_links` (JSONB) - Social media links
- `data_completeness_score` (0-100) - Completeness metric
- `last_discovered_at` - Discovery freshness tracking
- `last_crawled_at` - Crawl freshness tracking
- `crawl_status` - pending | success | failed | skipped

**Key Constraint:**
- `google_place_id` is now **globally unique** (not per-dataset)
- Businesses are deduplicated globally by `google_place_id`

**Indexes Added:**
- `idx_businesses_google_place_id_unique` (unique, partial: WHERE google_place_id IS NOT NULL)
- `idx_businesses_city_id`
- `idx_businesses_last_crawled_at`
- `idx_businesses_crawl_status`
- `idx_businesses_data_completeness`

### 2. Discovery Worker Behavior ✅

**File:** `src/workers/discoveryWorkerV2.ts`

**New Behavior:**
- **UPSERT by google_place_id globally** (not per-dataset)
- If business exists → UPDATE metadata, set `last_discovered_at`
- If business is new → INSERT with `crawl_status = 'pending'`
- **DO NOT enqueue crawling automatically**
- **DO NOT fetch Place Details** (website/phone)
- **DO NOT fetch contact information**

**Discovery Flow:**
1. Generate grid points
2. Expand keywords (grid × keyword)
3. Execute searches
4. **UPSERT businesses globally** by `google_place_id`
5. **Link businesses to dataset** via `dataset_businesses` junction table
6. **DO NOT create extraction jobs**

**Key Functions:**
- `upsertBusinessGlobal()` - Global upsert by `google_place_id`
- `linkBusinessToDataset()` - Creates dataset-business relationship

### 3. Dataset Model Refactor ✅

**Migration:** `src/db/migrations/create_dataset_businesses_junction.sql`

**New Table:** `dataset_businesses`
- `dataset_id` (UUID) → `datasets.id`
- `business_id` (INTEGER) → `businesses.id`
- `manually_included` (BOOLEAN)
- `manually_excluded` (BOOLEAN)
- `review_status` (pending | approved | rejected | flagged)
- `added_by_user_id` (UUID)
- `notes` (TEXT)

**Key Constraint:**
- `UNIQUE (dataset_id, business_id)` - Prevents duplicates

**Relationship:**
- Datasets are **views over businesses** (many-to-many)
- Datasets **do NOT own business data**
- Businesses can belong to multiple datasets

**Migration:**
- Existing `businesses.dataset_id` relationships migrated to `dataset_businesses`
- `businesses.dataset_id` kept temporarily for backward compatibility (will be deprecated)

### 4. TTL-Based Crawling Logic ✅

**File:** `src/crawl/crawlTTL.ts`

**Crawling Rules:**
```sql
Crawl IF:
  website IS NOT NULL
  AND (
    last_crawled_at IS NULL
    OR last_crawled_at < NOW() - INTERVAL '45 days'
  )
```

**Functions:**
- `shouldCrawlBusiness()` - Check if business needs crawling
- `getBusinessesNeedingCrawl()` - Get businesses that need crawling
- `markBusinessCrawled()` - Update TTL after crawl
- `markBusinessCrawlSkipped()` - Mark as skipped

**Crawling Triggers:**
- **NOT automatic** on discovery
- **On export** (if user requests refresh)
- **On paid refresh**
- **Via explicit crawl trigger**

### 5. Data Completeness Scoring ✅

**File:** `src/db/businessesShared.ts` → `recalculateDataCompletenessScore()`

**Scoring Algorithm:**
- Website present: +40
- Email present: +30
- Phone present: +20
- Address present: +10
- **Total: 0-100**

**Recalculated:**
- After discovery (metadata update)
- After crawling (contact extraction)
- After Place Details fetch (website/phone)

**Usage:**
- Filter incomplete businesses
- Prioritize enrichment
- Show completeness in UI

### 6. Export Behavior (TODO)

**Current:** Uses existing business data
**Future:** 
- Flag missing emails
- Flag stale data (>45 days since crawl)
- Optional "Refresh incomplete businesses" (paid)

## Implementation Status

### ✅ Completed

1. **Business Entity Upgrade**
   - Migration created
   - New fields added
   - Indexes created
   - Backfill logic included

2. **Discovery Worker Refactor**
   - Global upsert by `google_place_id`
   - Dataset linking via junction table
   - No automatic crawling
   - Enrichment-only behavior

3. **Dataset Model Refactor**
   - Junction table created
   - Migration script included
   - Functions for linking businesses

4. **TTL-Based Crawling**
   - TTL check functions
   - Crawl status tracking
   - Skip logic

5. **Data Completeness Scoring**
   - Scoring algorithm
   - Recalculation triggers
   - Database updates

### ⚠️ Needs Type Updates

Some files need type updates for `Business.dataset_id` being nullable:
- `src/exports/crawlIntegration.ts`
- `src/exports/exportHelpers.ts`
- `src/services/businessSyncService.ts`
- `src/services/datasetResultsService.ts`
- `src/types/export.ts`

**Fix:** Update these files to handle `dataset_id` as nullable or use `dataset_businesses` junction table.

### 📋 Remaining Tasks

1. **Update Export Logic**
   - Use `dataset_businesses` to get businesses in dataset
   - Flag missing/stale data
   - Add optional refresh

2. **Update API Endpoints**
   - Use `dataset_businesses` for dataset-business queries
   - Deprecate `businesses.dataset_id` queries

3. **Update Crawling Worker**
   - Check TTL before crawling
   - Update `last_crawled_at` and `crawl_status`
   - Recalculate completeness score

4. **Cost Tracking**
   - Track Google API calls per discovery run
   - Track crawls per export
   - Add credit deduction hooks

## Migration Path

### Step 1: Run Migrations

```bash
# 1. Upgrade businesses table
psql $DATABASE_URL -f src/db/migrations/upgrade_businesses_to_shared_assets.sql

# 2. Create dataset_businesses junction table
psql $DATABASE_URL -f src/db/migrations/create_dataset_businesses_junction.sql
```

### Step 2: Update Code

1. Discovery now uses `discoverBusinessesV2()` (already updated)
2. Use `dataset_businesses` for dataset-business queries
3. Update export logic to use junction table

### Step 3: Verify

1. Run discovery - businesses should be global
2. Check `dataset_businesses` table - relationships should exist
3. Verify no duplicates by `google_place_id`

## Key Benefits

### 1. No Duplicates
- Global deduplication by `google_place_id`
- Same business discovered by different users = one record

### 2. Cost Savings
- No redundant Google API calls
- No redundant crawling
- TTL-based crawling prevents unnecessary work

### 3. Data Quality
- Completeness scoring tracks data quality
- Freshness tracking (last_discovered_at, last_crawled_at)
- Enrichment over time

### 4. Scalability
- Businesses scale independently of datasets
- Datasets are lightweight views
- Supports millions of businesses

## Architecture Diagram

```
┌─────────────┐
│  Datasets   │ (Views - no business data)
└──────┬──────┘
       │
       │ many-to-many
       │
       ▼
┌──────────────────┐
│ dataset_businesses│ (Junction table)
└──────┬───────────┘
       │
       │ references
       │
       ▼
┌─────────────┐
│  Businesses │ (Global, shared assets)
└─────────────┘
       │
       ├── google_place_id (unique globally)
       ├── website, phone, emails
       ├── data_completeness_score
       ├── last_discovered_at
       └── last_crawled_at
```

## Non-Negotiable Constraints

✅ **DO NOT change crawling logic internals** - Only add TTL gates
✅ **DO NOT change Google Maps API field masks** - Discovery only uses Text Search
✅ **DO NOT promise 100% coverage** - System is best-effort
✅ **Datasets are views, not owners** - Use `dataset_businesses` junction table

## Next Steps

1. Fix type errors (update files to handle nullable `dataset_id`)
2. Update export logic to use `dataset_businesses`
3. Update API endpoints to use junction table
4. Add cost tracking
5. Test end-to-end flow
