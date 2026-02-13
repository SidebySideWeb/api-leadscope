# GEMI API Integration - Refactoring Summary

This document summarizes the refactoring from vrisko.gr/xo.gr scraping to GEMI API integration.

## ✅ Completed Components

### 1. Database Migration
- **File**: `src/db/migrations/create_gemi_tables.sql`
- Creates `prefectures`, `municipalities` tables
- Updates `industries` table with `gemi_id`
- Updates `businesses` table with:
  - `ar_gemi` (unique constraint)
  - `municipality_id`, `prefecture_id`
  - `website_url` from GEMI

### 2. Metadata Seed Script
- **File**: `scripts/seed-gemi-metadata.js`
- Fetches from GEMI API:
  - `/metadata/prefectures` → `prefectures` table
  - `/metadata/municipalities` → `municipalities` table
  - `/metadata/activities` → `industries` table
- **Usage**: `npm run seed:gemi-metadata`

### 3. GEMI API Service
- **File**: `src/services/gemiService.ts`
- Rate limiting: 8 req/min (7.5s delay between calls)
- Functions:
  - `fetchGemiCompaniesForMunicipality()` - Fetches with pagination
  - `importGemiCompaniesToDatabase()` - Imports with `ar_gemi` unique constraint

### 4. Search Endpoint
- **File**: `src/api/search.ts`
- **Route**: `GET /api/search`
- **Query params**: `municipality_id`, `industry_id`, `prefecture_id`, `page`, `limit`
- Queries local Supabase `businesses` table only
- Returns results with `total_count`

### 5. GEMI Fetch Worker
- **File**: `src/workers/gemiFetchWorker.ts`
- Background job to fetch businesses from GEMI API
- Processes jobs with rate limiting
- Automatically handles pagination

### 6. Enrichment Service
- **File**: `src/services/enrichmentService.ts`
- Scrapes websites for missing email/phone contacts
- Uses Cheerio (fast) and Playwright (JS-heavy sites)
- Functions:
  - `enrichBusiness()` - Enrich single business
  - `enrichMissingContacts()` - Batch enrichment

### 7. Export Endpoint
- **File**: `src/api/export.ts`
- **Route**: `POST /api/export`
- **Body**: `{ municipality_id?, industry_id?, prefecture_id?, start_row, end_row }`
- Max export: 1000 rows
- Pricing: `(end_row - start_row) * price_per_row`
- Returns Excel file (.xlsx) using ExcelJS

## 🔧 Configuration Required

### Environment Variables
```env
GEMI_API_BASE_URL=https://api.gemi.gov.gr
GEMI_API_KEY=your_api_key_here
EXPORT_PRICE_PER_ROW=0.01
```

### Database Migration
```bash
npm run migrate:gemi-tables
```

### Seed Metadata
```bash
npm run seed:gemi-metadata
```

## 🗑️ Old Scrapers to Remove (Not Yet Deleted)

The following files contain vrisko.gr/xo.gr scraping logic and should be removed or deprecated:

### Vrisko Scrapers:
- `src/crawler/vrisko/` - Entire directory
- `src/services/vriskoService.ts`
- `src/services/vriskoFetcher.ts`
- `src/discovery/vriskoWorker.ts`
- `src/discovery/vriskoDiscoveryWorker.ts`
- `src/workers/vriskoDiscoveryWorker.ts`
- `src/cli/runVriskoDiscovery.ts`
- `src/cli/vriskoDiscoveryWorker.ts`
- `src/cli/testVrisko.ts`
- `src/db/vriskoDiscoveryJobs.ts`

### References to Update:
- `src/services/discoveryService.ts` - Remove vrisko references
- `src/api/discovery.ts` - Update to use GEMI instead

## 📋 API Endpoints

### Search Businesses
```
GET /api/search?municipality_id=xxx&industry_id=yyy&prefecture_id=zzz&page=1&limit=50
```

### Export Businesses
```
POST /api/export
Body: {
  "municipality_id": "xxx",
  "industry_id": "yyy",
  "prefecture_id": "zzz",
  "start_row": 0,
  "end_row": 100
}
```

## 🔄 Workflow

1. **Seed Metadata**: Run `npm run seed:gemi-metadata` to populate prefectures, municipalities, industries
2. **Fetch Businesses**: Use `gemiFetchWorker` to fetch companies from GEMI API for a municipality
3. **Enrich Contacts**: Run `enrichMissingContacts()` to scrape websites for missing emails/phones
4. **Search**: Use `GET /api/search` to query local database
5. **Export**: Use `POST /api/export` to generate Excel files

## 🛡️ Database Integrity

- `ar_gemi` column has unique constraint to prevent duplicate businesses
- Uses `ON CONFLICT (ar_gemi) DO UPDATE` for upserts
- All GEMI imports respect the unique constraint

## 📝 Next Steps

1. Remove old vrisko/xo.gr scraper files
2. Update `discoveryService.ts` to use GEMI instead of vrisko
3. Test GEMI API integration with real API credentials
4. Set up background job scheduler for GEMI fetching
5. Monitor rate limiting compliance
