# Vrisko.gr Integration - Primary Discovery Source

## Overview

vrisko.gr is now the **PRIMARY** source for business discovery and contact extraction. Google Places API is used only as a **SECONDARY fallback** for business lists and websites.

## Architecture Changes

### 1. Discovery Flow (Primary → Fallback)

**Before:**
- Google Places API → Primary source
- High API costs

**After:**
- **vrisko.gr** → Primary source (FREE)
- **Google Places API** → Fallback only if vrisko returns no results

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
- **Discovery**: vrisko.gr (FREE) → Google Places (fallback only)
- **Extraction**: vrisko.gr contacts (FREE) → Website crawling (FREE) → Place Details (websites only, fallback)

**Estimated savings**: 80-90% reduction in Google Places API costs

## Data Flow

```
Discovery Request
    ↓
Try vrisko.gr (keyword + location)
    ↓
Found results? → YES → Use vrisko data (phones, email, website)
    ↓ NO
Fallback to Google Places API
    ↓
Create/Update Business
    ↓
Extraction Job Created
    ↓
Extract contacts from:
    1. vrisko.gr data (if available)
    2. Website crawling
    3. Place Details (websites only, if needed)
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
