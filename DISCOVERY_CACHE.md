# Discovery Cache System

## Overview

The discovery cache system optimizes discovery by **always running Google Maps API searches** (to catch new businesses) but **skips extraction** for businesses that already have complete data (website + contacts). This ensures fresh data while avoiding redundant crawling/extraction work.

## How It Works

### Discovery Flow

1. **User requests discovery** (e.g., "barbers in Athens")
2. **Always run Google Maps API search** - Gets fresh results (new businesses may have been added)
3. **Check existing businesses** - For each business found, check if it already has:
   - Website (in `websites` table)
   - At least one contact (email or phone in `contacts` + `contact_sources`)
4. **Skip extraction for complete businesses** - If business has website + contacts:
   - Add business to dataset (if not already there)
   - Skip extraction job creation
   - Log: "Skipping extraction - already has complete data"
5. **Extract incomplete businesses** - If business is new or missing data:
   - Add business to dataset
   - Create extraction job
   - Extract website and contacts

### Example Scenario

**User A** discovers "barbers in Athens":
- Calls Google Maps API → Finds 50 barbershops
- Extracts websites and contacts for all 50
- Stores complete data in database

**User B** discovers "barbers in Athens" (same search):
- ✅ Calls Google Maps API → Finds 50 barbershops (same + maybe new ones)
- ✅ Checks each business: 45 have complete data, 5 are new
- ✅ Adds all 50 businesses to User B's dataset
- ⚡ Skips extraction for 45 businesses (already have website + contacts)
- 🔍 Extracts only the 5 new businesses
- **Result**: Fresh data + avoids redundant work

## Implementation Details

### Complete Data Check

```typescript
getBusinessesWithCompleteData(googlePlaceIds: string[]): Promise<Set<string>>
```

- Checks which businesses already have website + contacts
- Returns Set of Google Place IDs that have complete data
- Used to filter out businesses that don't need extraction

### Integration in Discovery Worker

The system **always runs Google Maps API** but filters extraction:

```typescript
// 1. Always run Google Maps API (to catch new businesses)
const places = await googleMapsService.searchPlaces(...);

// 2. Check which businesses already have complete data
const businessesWithCompleteData = await getBusinessesWithCompleteData(placeIds);

// 3. Process each place
for (const place of places) {
  const hasCompleteData = businessesWithCompleteData.has(place.place_id);
  
  // Add business to dataset (always)
  await upsertBusiness(...);
  
  // Skip extraction if already has complete data
  if (hasCompleteData) {
    continue; // Don't create extraction job
  }
}

// 4. Only create extraction jobs for incomplete businesses
// SQL filters out businesses with website + contacts
```

## Benefits

### Always Fresh Data
- **Always runs Google Maps API** - Catches new businesses that may have been added
- No stale data - every discovery gets latest results

### Cost Savings
- **Reduces extraction work** - Skips crawling/contact extraction for businesses we already have
- Example: 10 users search "barbers in Athens"
  - Without optimization: 10 API calls + 500 extractions (50 businesses × 10 users)
  - With optimization: 10 API calls + 50 extractions (only new businesses)

### Performance
- **Faster extraction** - Only extracts businesses that need it
- Typical discovery: Processes 50 businesses, extracts only 5 new ones

### Data Quality
- Ensures all businesses have complete data (website + contacts)
- Avoids redundant crawling work

## Complete Data Criteria

### What Counts as "Complete"
A business has complete data if it has:
1. **Website** - At least one record in `websites` table
2. **Contact** - At least one contact (email or phone) linked via `contact_sources`

### Data Freshness
- **Always runs Google Maps API** - Ensures fresh search results
- New businesses are automatically detected and extracted
- Existing businesses with complete data are skipped

## Limitations

### Current Limitations
1. **Always Runs API**: Google Maps API is always called (no skipping)
   - Ensures fresh data but uses API quota
   - Trade-off: Fresh data vs API costs

2. **Complete Data Check**: Only skips extraction, not discovery
   - Businesses are still added to dataset
   - Extraction is skipped if website + contacts exist

3. **No Partial Updates**: If business has website but no contacts, still extracts
   - Future: Could check for partial data and only extract missing pieces

## Future Enhancements

### Potential Improvements
1. **Partial Data Extraction**: Only extract missing pieces (e.g., if website exists but no contacts, only extract contacts)
2. **Extraction Statistics**: Track how many businesses are skipped vs extracted
3. **Smart Caching**: Cache Google Maps API results (with TTL) while still checking for new businesses
4. **Incremental Updates**: Update existing businesses with new data from Google Maps

## Configuration

### Environment Variables
- None required - cache is automatic

### Tuning Parameters
- `minCount`: Minimum businesses for cache validity (default: 5)
  - Lower = more cache hits, but potentially stale data
  - Higher = fewer cache hits, but better data quality

## Monitoring

### Logs
Operations are logged with prefixes:
- `[discoverBusinesses] Checking N businesses for existing complete data...`
- `[discoverBusinesses] Found N businesses with complete data (will skip extraction)`
- `[processPlace] Skipping extraction for business X - already has complete data`
- `[discoverBusinesses] Skipped N businesses with complete data (no extraction needed)`

### Metrics to Track
- Extraction skip rate (businesses skipped / total businesses)
- Average businesses extracted per discovery
- Cost savings (extractions avoided)

## Database Schema

### Relevant Tables
- `businesses` - Stores cached businesses
  - `industry_id` - Used for cache lookup
  - `city_id` - Used for cache lookup
  - `google_place_id` - Required for cache validity
  - `dataset_id` - Target dataset (copied to)

### Indexes
Recommended indexes for cache performance:
```sql
CREATE INDEX IF NOT EXISTS idx_businesses_industry_city 
ON businesses(industry_id, city_id) 
WHERE google_place_id IS NOT NULL;
```

## Testing

### Test Cache Hit
1. Run discovery for "barbers in Athens" (User A)
2. Run same discovery for "barbers in Athens" (User B)
3. Verify: User B gets cache hit, no API call

### Test Cache Miss
1. Run discovery for rare industry+city combination
2. Verify: Cache miss, API call happens
3. Run same discovery again
4. Verify: Cache hit on second run
