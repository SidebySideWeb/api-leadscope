# Database-First Discovery with Vrisko.gr Fallback

## Overview

The system now uses a **DATABASE-FIRST** approach for discovery:
1. **Database** → Check existing businesses matching industry + city
2. **vrisko.gr** → Only if database has < 50 results
3. **Google Places API** → REMOVED (no longer used)

This eliminates all Google Places API costs and reuses existing data.

## Architecture Changes

### 1. Discovery Flow (Database → Vrisko → Never Google)

**Before:**
- Google Places API → Primary source
- High API costs

**After:**
- **Database** → Primary source (FREE, instant)
- **vrisko.gr** → Secondary source (FREE, only if DB has < 50 results)
- **Google Places API** → REMOVED (no longer used)

### 2. Contact Extraction Flow

**Before:**
- Website crawling → Primary
- Google Place Details API → Fallback for phone/email/website

**After:**
- **vrisko.gr** → Primary source for phone/email (already in listing)
- **Website crawling** → Primary for email extraction
- **Google Place Details API** → Fallback ONLY for websites (not contacts)

## Key Components

### 1. Vrisko Crawler (`src/crawler/vrisko/`)

- `vriskoCrawler.ts` - Main crawler with pagination support
- `vriskoParser.ts` - HTML parser for vrisko.gr listings
- `utils/httpClient.ts` - HTTP client with anti-blocking features
- `utils/delay.ts` - Delay utilities
- `utils/logger.ts` - Logging utilities

**Features:**
- Automatic pagination
- Random user agents
- Request delays (500-2000ms)
- Retry logic (3 attempts)
- Extracts: name, category, address, phones, email, website, coordinates

### 2. Vrisko Service (`src/services/vriskoService.ts`)

- Converts vrisko results to `GooglePlaceResult` format for compatibility
- Integrates with existing discovery system
- Handles search queries and result conversion

### 3. Updated Discovery Worker (`src/workers/discoveryWorkerV2.ts`)

- Tries vrisko.gr first for each search
- Falls back to Google Places if vrisko returns no results
- Logs which source was used

### 4. Updated Extraction Worker (`src/workers/extractWorker.ts`)

- **REMOVED**: Place Details API calls for phone/email
- **KEPT**: Place Details API for websites only (as fallback)
- Contacts come from vrisko.gr (primary) or website crawling

## Usage

### Test Vrisko Crawler

```bash
npm run test:vrisko "Γιατρός" "Αθήνα ΑΤΤΙΚΗΣ" 5
```

### Discovery Process

Discovery automatically uses vrisko.gr first:

1. For each keyword + location search:
   - Try vrisko.gr
   - If no results → Fallback to Google Places API
   
2. Results are converted to standard format
3. Businesses are created/updated in database
4. Extraction jobs are created for contact enrichment

## Cost Reduction

### Before:
- **Discovery**: Google Places Text Search ($0.032 per search)
- **Extraction**: Google Place Details ($0.017 per call) for phone/email/website

### After:
- **Discovery**: Database (FREE, instant) → vrisko.gr (FREE, only if needed)
- **Extraction**: Database contacts (FREE) → vrisko.gr contacts (FREE) → Website crawling (FREE) → Place Details (websites only, fallback)

**Cost savings**: **100% reduction** in Google Places API costs for discovery. Zero API calls for discovery.

## Data Flow

```
Discovery Request (industry_id + city_id)
    ↓
STEP 1: Check Database
    ↓
Found businesses? → YES → Use database businesses (with contacts)
    ↓ NO (or < 50 results)
STEP 2: Try vrisko.gr (keyword + location)
    ↓
Found results? → YES → Use vrisko data (phones, email, website)
    ↓ NO
Return combined results (DB + vrisko)
    ↓
Create/Update Business (if new from vrisko)
    ↓
Extraction Job Created (only if needed)
    ↓
Extract contacts from:
    1. Database (already has contacts)
    2. vrisko.gr data (if available)
    3. Website crawling
    4. Place Details (websites only, if needed)
```

## Future Enhancements

1. **Store vrisko contacts immediately** - When businesses are discovered from vrisko, store contacts directly (no extraction job needed)
2. **Cache vrisko results** - Avoid re-crawling same searches
3. **Rate limiting** - Add configurable rate limits for vrisko crawling
4. **Proxy support** - Add proxy rotation for vrisko requests

## Configuration

No additional configuration needed. The system automatically:
- Uses vrisko.gr as primary source
- Falls back to Google Places when needed
- Respects existing discovery config (max pages, concurrency, etc.)

## Testing

```bash
# Test vrisko crawler directly
npm run test:vrisko "keyword" "location" [maxPages]

# Run discovery (will use vrisko first)
npm run discover
```

## Notes

- vrisko.gr is a Greek business directory
- Results include phone, email, website directly in listings
- No API costs for vrisko.gr (web scraping)
- Respects robots.txt and uses delays to avoid blocking
