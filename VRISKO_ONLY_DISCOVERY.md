# Vrisko.gr Only Discovery System

## Overview

The discovery system has been completely refactored to use **ONLY vrisko.gr** as the discovery source. All Google Maps/Places API logic has been removed from discovery.

## Architecture

### Discovery Flow

```
User Request (city_id + industry_id)
    ↓
Discovery API Endpoint
    ↓
Discovery Service (runDiscoveryJob)
    ↓
Vrisko Discovery Worker (discoverBusinessesVrisko)
    ↓
Vrisko Crawler (crawls vrisko.gr)
    ↓
Business Storage (upsertBusinessGlobal)
    ↓
Extraction Jobs (for website crawling)
```

### Key Components

1. **`src/discovery/vriskoDiscoveryWorker.ts`**
   - Main discovery worker
   - Fetches cities and industries from database
   - Crawls vrisko.gr for each keyword
   - Stores businesses with contacts

2. **`src/crawler/vrisko/`**
   - Vrisko crawler implementation
   - Handles pagination, parsing, anti-blocking

3. **`src/services/discoveryService.ts`**
   - Orchestrates discovery jobs
   - Uses vriskoDiscoveryWorker (no Google)

## Database Schema

### Cities Table
- `id` (UUID)
- `name` (string)
- `is_active` (boolean) - Filter for active cities
- `vrisko_search` (string, optional) - Custom search string for vrisko

### Industries Table
- `id` (UUID)
- `name` (string)
- `is_active` (boolean) - Filter for active industries
- `discovery_keywords` (JSONB array) - Keywords to search
- `vrisko_keyword` (string, optional) - Primary keyword for vrisko
- `crawl_priority` (number, optional) - Priority for bulk discovery

## Discovery Process

### 1. Keyword Selection

For each industry:
- **Primary**: `vrisko_keyword` (if available) or `industry.name`
- **Secondary**: All keywords from `discovery_keywords` array

### 2. Location Selection

For each city:
- **Primary**: `vrisko_search` (if available) or `city.name`

### 3. Search Execution

For each (keyword, location) combination:
- Crawl vrisko.gr search pages
- Handle pagination automatically
- Stop when no more results
- Extract business listings

### 4. Business Storage

For each discovered business:
- Upsert to `businesses` table
- Deduplicate by name + location
- Store website, phone, email from vrisko listing
- Link to dataset via `dataset_businesses`
- Create extraction job for website crawling (if website found)

## Usage

### API Endpoint

```bash
POST /discovery/businesses
{
  "city_id": "uuid",
  "industry_id": "uuid",
  "dataset_id": "uuid" // optional
}
```

### CLI Tool

```bash
# Discover specific city-industry combination
npm run discover:vrisko <cityId> <industryId> [datasetId]

# Discover all active combinations
npm run discover:vrisko
```

## Removed Components

### Deprecated/Removed:
- ❌ `discoveryWorkerV2.ts` - Deprecated (used Google Places API)
- ❌ Google Places API calls in discovery
- ❌ Google Maps geolocation for discovery
- ❌ Grid-based discovery (not needed for vrisko)

### Still Available (Non-Discovery):
- ✅ `googleMapsService.ts` - Still used for:
  - City coordinate resolution (non-discovery)
  - Place Details for website enrichment (extractWorker)
  - Business sync/refresh (businessSyncService)

## Benefits

1. **Zero API Costs** - vrisko.gr is free (web scraping)
2. **Complete Data** - vrisko listings include phone, email, website directly
3. **No Rate Limits** - No API quotas to manage
4. **Faster Results** - Direct database queries + web scraping
5. **Better Coverage** - vrisko.gr has comprehensive Greek business listings

## Future Extensibility

The system is designed to support multiple discovery sources via adapters:

```typescript
// Future: Add more sources
const sources = ['vrisko', 'yellowpages', '11880'];
for (const source of sources) {
  await discoverFromSource(source, cityId, industryId);
}
```

## Migration Notes

- Old `discoverBusinessesV2` function throws error if called
- All discovery now goes through `discoverBusinessesVrisko`
- Google Place ID field still exists in database but is populated with `vrisko_<hash>` format
- Discovery runs are tracked in `discovery_runs` table
