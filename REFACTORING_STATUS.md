# Shared Business Intelligence Refactoring - Status

## ✅ Completed Sections

### Section 1: Business Entity Upgrade
- ✅ Migration: `upgrade_businesses_to_shared_assets.sql`
- ✅ New fields: latitude, longitude, website, phone, emails, social_links
- ✅ Completeness scoring: data_completeness_score (0-100)
- ✅ Freshness tracking: last_discovered_at, last_crawled_at
- ✅ Crawl status: crawl_status (pending | success | failed | skipped)
- ✅ Global uniqueness: google_place_id unique constraint
- ✅ Indexes: All required indexes created

### Section 2: Discovery Worker Behavior
- ✅ Refactored: `discoveryWorkerV2.ts` uses global upsert
- ✅ Idempotent: UPSERT by google_place_id globally
- ✅ Enrichment-only: Updates metadata, sets last_discovered_at
- ✅ No auto-crawling: Does NOT create extraction jobs
- ✅ No Place Details: Does NOT fetch website/phone during discovery
- ✅ Dataset linking: Links businesses to datasets via junction table

### Section 3: Dataset Model Refactor
- ✅ Junction table: `dataset_businesses` created
- ✅ Migration: Existing relationships migrated
- ✅ Functions: `addBusinessToDataset()`, `getBusinessesInDataset()`
- ✅ Manual control: include/exclude flags, review status

### Section 4: TTL-Based Crawling Logic
- ✅ TTL checks: `shouldCrawlBusiness()`, `getBusinessesNeedingCrawl()`
- ✅ Rules: website IS NOT NULL AND (never crawled OR >45 days)
- ✅ Status tracking: `markBusinessCrawled()`, `markBusinessCrawlSkipped()`
- ✅ Export check: `needsCrawlForExport()`

### Section 5: Data Completeness Scoring
- ✅ Algorithm: Website=40, Email=30, Phone=20, Address=10
- ✅ Recalculation: After discovery, crawling, Place Details fetch
- ✅ Database updates: Score stored in businesses table

## ⚠️ Type Compatibility Issues

Some files expect `Business.dataset_id` to be non-null, but it's now nullable (deprecated).

**Files needing updates:**
1. `src/exports/crawlIntegration.ts` - Line 57
2. `src/exports/exportHelpers.ts` - Lines 41, 98
3. `src/services/businessSyncService.ts` - Line 88
4. `src/services/datasetResultsService.ts` - Line 130
5. `src/types/export.ts` - Line 155

**Fix Options:**
- Option A: Use `dataset_businesses` junction table (recommended)
- Option B: Handle nullable `dataset_id` with fallback

## 📋 Remaining Tasks

### Section 6: Export Behavior
- [ ] Update export to use `dataset_businesses` junction table
- [ ] Flag missing emails in export
- [ ] Flag stale data (>45 days since crawl)
- [ ] Add optional "Refresh incomplete businesses" button

### Additional Updates Needed
- [ ] Update API endpoints to use `dataset_businesses`
- [ ] Update crawling worker to check TTL
- [ ] Update crawling worker to update `last_crawled_at` and `crawl_status`
- [ ] Add cost tracking (API calls, crawls)
- [ ] Update UI to show completeness scores

## 🚀 How to Deploy

### Step 1: Run Migrations

```bash
# Backup database first!
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Run migrations
psql $DATABASE_URL -f src/db/migrations/upgrade_businesses_to_shared_assets.sql
psql $DATABASE_URL -f src/db/migrations/create_dataset_businesses_junction.sql
```

### Step 2: Verify Migrations

```sql
-- Check businesses table has new fields
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'businesses' 
AND column_name IN ('latitude', 'longitude', 'website', 'phone', 'emails', 'social_links', 'data_completeness_score', 'last_discovered_at', 'last_crawled_at', 'crawl_status');

-- Check dataset_businesses table exists
SELECT COUNT(*) FROM dataset_businesses;

-- Check google_place_id uniqueness
SELECT google_place_id, COUNT(*) 
FROM businesses 
WHERE google_place_id IS NOT NULL 
GROUP BY google_place_id 
HAVING COUNT(*) > 1;
-- Should return 0 rows
```

### Step 3: Test Discovery

```typescript
// Run discovery - businesses should be global
const result = await discoverBusinessesV2({
  industry_id: 'test-industry-id',
  city_id: 'test-city-id',
  datasetId: 'test-dataset-id'
}, 'test-discovery-run-id');

// Verify:
// 1. Businesses created globally (not per-dataset)
// 2. dataset_businesses entries created
// 3. No extraction jobs created automatically
```

## 🔍 Key Architectural Changes

### Before (Dataset-Owned)
```
Dataset → owns → Businesses
- Same business in 2 datasets = 2 records
- Duplicate discovery = duplicate businesses
- Crawling triggered automatically
```

### After (Shared Assets)
```
Dataset → references → Businesses (via dataset_businesses)
- Same business in 2 datasets = 1 record, 2 references
- Duplicate discovery = enrichment only
- Crawling triggered explicitly (TTL-based)
```

## 📊 Data Flow

### Discovery Flow
1. User requests discovery
2. Grid-based search executes
3. **UPSERT businesses globally** by `google_place_id`
4. **Link businesses to dataset** via `dataset_businesses`
5. **DO NOT create extraction jobs**

### Crawling Flow (Separate)
1. User exports dataset OR requests refresh
2. Check TTL: `shouldCrawlBusiness()`
3. If needs crawl: Create extraction job
4. Crawl website
5. Extract contacts
6. Update `last_crawled_at`, `crawl_status`
7. Recalculate `data_completeness_score`

### Export Flow
1. Get businesses in dataset: `getBusinessesInDataset()`
2. Use existing business data
3. Flag missing emails (if `data_completeness_score < 70`)
4. Flag stale data (if `last_crawled_at < NOW() - 45 days`)
5. Optional: "Refresh incomplete businesses" (paid)

## 🎯 Success Criteria

- [x] Businesses deduplicated globally by `google_place_id`
- [x] Discovery is idempotent (safe to re-run)
- [x] Discovery does NOT trigger crawling
- [x] Datasets reference businesses (not own them)
- [x] TTL-based crawling logic implemented
- [x] Data completeness scoring implemented
- [ ] Export uses existing data (needs update)
- [ ] Cost tracking implemented (needs implementation)

## 📝 Notes

- `businesses.dataset_id` is deprecated but kept for backward compatibility
- Migration preserves existing relationships
- All new code uses `dataset_businesses` junction table
- Old code continues to work (with deprecation warnings)
