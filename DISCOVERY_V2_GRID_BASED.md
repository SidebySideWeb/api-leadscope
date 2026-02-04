# Discovery Worker V2 - Grid-Based Discovery

## Overview

Discovery Worker V2 implements a **grid-based city coverage strategy** that maximizes business discovery while respecting Google Places API limitations. It replaces the single-radius approach with a systematic grid search that ensures comprehensive coverage.

## Architecture

### Key Components

1. **Grid Generation** (`src/utils/geo.ts`)
   - Generates overlapping grid points covering the city
   - Configurable grid density and radius

2. **Keyword Expansion** (`src/workers/discoveryWorkerV2.ts`)
   - Each grid point × keyword = one search
   - Supports multiple keywords per industry

3. **Stop Conditions** (`src/workers/discoveryWorkerV2.ts`)
   - Stops when new businesses drop below threshold
   - Prevents wasteful API calls

4. **Coverage Metrics** (`src/workers/discoveryWorkerV2.ts`)
   - Tracks grid points, searches, unique businesses
   - Calculates coverage score

5. **Configuration** (`src/config/discoveryConfig.ts`)
   - All parameters configurable via environment variables
   - Sensible defaults provided

## Grid-Based Discovery Flow

### 1. City Grid Generation

**Input:**
- City center (lat, lng)
- City radius (km)
- Grid density (km) - default: 1.5km

**Process:**
```typescript
const gridPoints = generateGridPoints(
  centerLat,
  centerLng,
  radiusKm,
  gridDensity
);
```

**Output:**
- Array of `{ lat, lng }` grid centers
- Points overlap by ~50% (ensures coverage)

**Example:**
- Athens: 15km radius, 1.5km density → ~100 grid points

### 2. Keyword Expansion

**Input:**
- Grid points (e.g., 100 points)
- Industry keywords (e.g., ["barber", "barbershop", "κουρείο"])

**Process:**
```typescript
for (const gridPoint of gridPoints) {
  for (const keyword of keywords) {
    searchTasks.push({ gridPoint, keyword });
  }
}
```

**Output:**
- Search tasks: grid points × keywords
- Example: 100 points × 3 keywords = 300 search tasks

### 3. Discovery Execution

**For each search task:**
```typescript
POST /places:searchText
{
  textQuery: keyword,
  locationBias: {
    circle: {
      center: { lat, lng },
      radius: gridRadiusKm * 1000 // meters
    }
  },
  languageCode: 'el',
  regionCode: 'GR'
}
```

**Field Mask (Discovery Only):**
```
places.id,places.displayName,places.formattedAddress,
places.location,places.rating,places.userRatingCount,
places.types,places.addressComponents
```

**Critical:** Does NOT request:
- `websiteUri` (requires Place Details API)
- `nationalPhoneNumber` (requires Place Details API)

### 4. Deduplication (CRITICAL)

**Primary:** `google_place_id`
- If same `place_id` found → skip duplicate

**Secondary:** Normalized name + city
- Database constraint prevents duplicates
- Handled by `upsertBusiness()`

**Result:** Idempotent discovery
- Multiple runs = no duplicates
- Safe to re-run discovery

### 5. Stop Conditions

**Logic:**
```typescript
if (batchNewPercent < minNewBusinessesPercent && batchTotalFound > 0) {
  consecutiveLowYieldBatches++;
  if (consecutiveLowYieldBatches >= 3) {
    stopEarly = true;
  }
}
```

**Default:** Stop if 3 consecutive batches have <2% new businesses

**Benefits:**
- Prevents infinite queries
- Saves API costs
- Stops when coverage is complete

### 6. Coverage Metrics

**Tracked:**
- `gridPointsGenerated` - Number of grid points created
- `searchesExecuted` - API calls made
- `uniqueBusinessesDiscovered` - Unique businesses found
- `coverageScore` - Heuristic: unique businesses / grid points

**Example:**
```
Grid points: 100
Searches executed: 300 (100 points × 3 keywords)
Unique businesses: 150
Coverage score: 1.5 (businesses per grid point)
```

## Configuration

### Environment Variables

```bash
# Grid generation
DISCOVERY_GRID_RADIUS_KM=1.5        # Radius per grid point (default: 1.5km)
DISCOVERY_GRID_DENSITY=1.5          # Grid step size (default: 1.5km)

# Search limits
DISCOVERY_MAX_SEARCHES=500          # Max API calls per discovery (default: 500)
DISCOVERY_MIN_NEW_PERCENT=2          # Stop threshold % (default: 2%)

# Rate limiting
DISCOVERY_CONCURRENCY=3              # Concurrent requests (default: 3)
DISCOVERY_REQUEST_DELAY_MS=200       # Delay between requests (default: 200ms)

# Retry logic
DISCOVERY_RETRY_ATTEMPTS=3           # Retry attempts (default: 3)
DISCOVERY_RETRY_DELAY_MS=1000       # Base retry delay (default: 1000ms)
```

### Default Configuration

```typescript
{
  gridRadiusKm: 1.5,        // 1.5km radius per grid point
  gridDensity: 1.5,         // 1.5km step (creates ~50% overlap)
  maxSearchesPerDataset: 500, // Max API calls
  minNewBusinessesPercent: 2, // Stop if <2% new
  concurrency: 3,            // 3 concurrent requests
  requestDelayMs: 200,       // 200ms delay
  retryAttempts: 3,          // 3 retries
  retryDelayMs: 1000         // 1s base delay
}
```

## Usage

### Programmatic

```typescript
import { discoverBusinessesV2 } from './workers/discoveryWorkerV2.js';

const result = await discoverBusinessesV2({
  industry_id: 'uuid',
  city_id: 'uuid',
  datasetId: 'uuid'
}, discoveryRunId, {
  gridRadiusKm: 2.0,  // Override default
  gridDensity: 1.0    // Override default
});
```

### Via Discovery Service

```typescript
import { runDiscoveryJob } from './services/discoveryService.js';

await runDiscoveryJob({
  userId: 'uuid',
  industry_id: 'uuid',
  city_id: 'uuid',
  datasetId: 'uuid'
});
```

## Benefits

### 1. Comprehensive Coverage
- **Grid-based** ensures no areas are missed
- **Overlapping points** catch businesses at boundaries
- **Multiple keywords** catch variations (barber, barbershop, κουρείο)

### 2. Cost Control
- **Stop conditions** prevent wasteful queries
- **Configurable limits** (max searches per dataset)
- **Efficient deduplication** avoids redundant processing

### 3. Scalability
- **Concurrent processing** (configurable)
- **Rate limiting** respects API limits
- **Retry logic** handles transient failures

### 4. Idempotency
- **Deduplication by place_id** prevents duplicates
- **Safe to re-run** discovery
- **Database constraints** enforce uniqueness

## Comparison: V1 vs V2

### V1 (Single Radius)
- ❌ Single search point
- ❌ Result caps (20-60 businesses)
- ❌ Missing businesses
- ❌ Non-repeatable coverage

### V2 (Grid-Based)
- ✅ Multiple grid points (100+)
- ✅ Comprehensive coverage
- ✅ Catches all businesses
- ✅ Repeatable, idempotent

## Example: Athens Barbers

**Input:**
- City: Athens (37.9838, 23.7275, 15km radius)
- Industry: Barbers (keywords: ["barber", "barbershop", "κουρείο"])

**Process:**
1. Generate grid: ~100 points (15km radius, 1.5km density)
2. Expand keywords: 100 points × 3 keywords = 300 searches
3. Execute searches: 300 API calls (with concurrency + rate limiting)
4. Deduplicate: ~150 unique businesses
5. Stop early: If <2% new businesses for 3 consecutive batches

**Result:**
- Grid points: 100
- Searches executed: 300
- Unique businesses: 150
- Coverage score: 1.5

## Separation of Concerns

### Discovery Phase
- ✅ Finds businesses via Google Maps API
- ✅ Stores business metadata (name, address, location)
- ✅ Does NOT fetch website/phone (Place Details API)
- ✅ Creates extraction jobs for incomplete businesses

### Extraction Phase (Separate)
- ✅ Fetches website/phone from Place Details API (if missing)
- ✅ Crawls websites for contacts
- ✅ Extracts emails/phones
- ✅ Links contacts to businesses

### Crawling Phase (Separate)
- ✅ Crawls business websites
- ✅ Extracts contact information
- ✅ Updates contact sources

## Error Handling

### Retry Logic
- Exponential backoff: `delay = baseDelay * 2^(attempt-1)`
- Default: 3 attempts, 1s base delay
- Configurable via environment variables

### Error Tracking
- Errors logged per search task
- Discovery continues on individual failures
- Final result includes error summary

## Monitoring

### Logs
```
[discoverBusinessesV2] Generated 100 grid points
[discoverBusinessesV2] Total search tasks: 300
[discoverBusinessesV2] Batch 1: 45 new, 50 total, 90.0% new
[discoverBusinessesV2] Batch 2: 30 new, 50 total, 60.0% new
[discoverBusinessesV2] Stopped early: 3 consecutive batches with <2% new businesses
[discoverBusinessesV2] Coverage score: 1.5
```

### Metrics
- Grid points generated
- Searches executed
- Unique businesses discovered
- Coverage score
- Stop reason (if stopped early)

## Future Enhancements

### Potential Improvements
1. **Adaptive Grid Density**: Increase density in high-business areas
2. **Smart Keyword Selection**: Use ML to select best keywords
3. **Cache Grid Results**: Cache grid point results for faster re-discovery
4. **Parallel Grid Generation**: Generate multiple grids for large cities
5. **Coverage Visualization**: Visualize grid coverage on map

## Migration from V1

### Breaking Changes
- None - V2 is backward compatible
- Uses same `DiscoveryInput` interface
- Same `DiscoveryResult` structure (with additional metrics)

### Migration Path
1. Update `discoveryService.ts` to use `discoverBusinessesV2`
2. Set environment variables (optional - defaults work)
3. Monitor coverage metrics
4. Adjust configuration as needed

## Testing

### Test Grid Generation
```typescript
import { generateGridPoints } from './utils/geo.js';

const points = generateGridPoints(37.9838, 23.7275, 15, 1.5);
console.log(`Generated ${points.length} grid points`);
```

### Test Discovery
```typescript
import { discoverBusinessesV2 } from './workers/discoveryWorkerV2.js';

const result = await discoverBusinessesV2({
  industry_id: 'test-industry-id',
  city_id: 'test-city-id',
  datasetId: 'test-dataset-id'
}, 'test-discovery-run-id');

console.log(`Found ${result.uniqueBusinessesDiscovered} businesses`);
console.log(`Coverage score: ${result.coverageScore}`);
```
