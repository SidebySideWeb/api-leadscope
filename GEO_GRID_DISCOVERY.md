# Geo-Grid Discovery System

## Overview

The geo-grid discovery system extends the existing Google Places discovery to bypass result limits and discover **ALL** businesses in a city by dividing the area into a geographic grid and searching at each point.

## How It Works

### Traditional Text Search
- Single query: `"restaurant Athens"`
- Result: ~20-60 businesses (limited by Google API)

### Geo-Grid Discovery
- Divides city into grid points (1.5km spacing)
- Searches at each grid point
- Merges and deduplicates results by `place_id`
- Result: **1,000-6,000+ businesses** (depending on city size)

## Architecture

### Files Created

1. **`src/utils/haversine.ts`**
   - Calculates distance between geographic points
   - Uses Haversine formula for accurate Earth-surface distances

2. **`src/utils/geo.ts`**
   - Generates grid points covering a circular area
   - Configurable grid step size (default: 1.5km)
   - Filters points within radius

3. **`src/services/geoGrid.ts`**
   - Main geo-grid discovery service
   - Rate limiting and retry logic
   - Deduplication by `place_id`
   - Comprehensive logging

## Usage

### CLI Command

```bash
# Simple text search (original behavior)
npm run discover "restaurant" "Athens"

# Geo-grid discovery
npm run discover "restaurant" "Athens" 37.9838 23.7275 15 --geo-grid
```

**Parameters:**
- `industry`: Business type (e.g., "restaurant", "law firm")
- `city`: City name (optional for geo-grid)
- `latitude`: Center latitude (required for geo-grid)
- `longitude`: Center longitude (required for geo-grid)
- `radiusKm`: Search radius in kilometers (required for geo-grid)
- `--geo-grid`: Enable geo-grid mode

### Programmatic Usage

```typescript
import { geoGridDiscoveryService } from './services/geoGrid.js';

const result = await geoGridDiscoveryService.discoverBusinessesByCity({
  industry: 'restaurant',
  city: {
    name: 'Athens',
    lat: 37.9838,
    lng: 23.7275,
    radiusKm: 15
  },
  gridStepKm: 1.5,        // Optional
  searchRadiusMeters: 1500, // Optional
  maxRequestsPerSecond: 5, // Optional
  requestDelayMs: 250,     // Optional
  retryAttempts: 3          // Optional
});

console.log(`Found ${result.results.length} unique businesses`);
console.log(`Stats:`, result.stats);
```

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `gridStepKm` | 1.5 | Distance between grid points (km) |
| `searchRadiusMeters` | 1500 | Search radius per grid point (meters) |
| `maxRequestsPerSecond` | 5 | Rate limit for API calls |
| `requestDelayMs` | 200-300 | Random delay between requests (ms) |
| `retryAttempts` | 3 | Number of retries for failed requests |

## Rate Limiting & Safety

- **Max 5 requests/second** (configurable)
- **200-300ms delay** between requests (randomized)
- **Exponential backoff** on retries
- **Queue-based processing** using `p-queue`
- **Graceful error handling** - continues on partial failures

## Deduplication

- **Primary key**: `place_id` (Google's unique identifier)
- **Map-based deduplication**: `Map<place_id, GooglePlaceResult>`
- **Automatic skipping** of duplicates
- **Statistics tracking**: duplicates skipped count

## Logging

The system provides comprehensive logging:

```
🔍 Starting geo-grid discovery for Athens
   Industry: restaurant
   Center: 37.9838, 23.7275
   Radius: 15 km
   Grid step: 1.5 km

📍 Generated 45 grid points

   [1/45] Searching at 37.9838, 23.7275
      ✓ Found 12 businesses (12 unique so far)
   [2/45] Searching at 37.9950, 23.7275
      ✓ Found 8 businesses (18 unique so far)
   ...

✅ Geo-grid discovery completed:
   Grid points: 45
   API calls: 45
   Total businesses found: 1,234
   Unique place IDs: 856
   Duplicates skipped: 378
```

## Integration

The geo-grid discovery is **automatically integrated** into the existing discovery worker:

- If `useGeoGrid: true` is set in `DiscoveryInput`, geo-grid mode is used
- Otherwise, falls back to simple text search
- Same database saving logic applies to both modes

## Performance

### Example Results

**Athens (15km radius):**
- Grid points: ~45-60
- API calls: ~45-60
- Unique businesses: 1,000-3,000
- Time: ~5-10 minutes

**Thessaloniki (12km radius):**
- Grid points: ~30-40
- API calls: ~30-40
- Unique businesses: 800-2,000
- Time: ~3-7 minutes

## Best Practices

1. **Start with smaller radius** (10-15km) to test
2. **Monitor API quota** - each grid point = 1 API call
3. **Use appropriate grid step** - 1.5km is optimal for coverage vs. cost
4. **Check logs** for errors and adjust retry settings if needed
5. **Run during off-peak hours** for large cities

## Limitations

- **API costs**: More API calls = higher costs
- **Time**: Large cities can take 10-20 minutes
- **Rate limits**: Must respect Google's rate limits
- **Coverage**: Some businesses may still be missed if outside grid

## Future Enhancements

- [ ] Adaptive grid sizing based on business density
- [ ] Parallel processing with multiple API keys
- [ ] Caching of grid points to avoid re-searching
- [ ] Support for polygon boundaries (not just circles)
- [ ] Automatic radius optimization

## Troubleshooting

### "Too many API calls"
- Reduce `radiusKm` or increase `gridStepKm`
- Reduce `maxRequestsPerSecond`

### "No results found"
- Check coordinates are correct
- Verify Google Maps API key has Places API enabled
- Check API quota/billing

### "Rate limit exceeded"
- Increase `requestDelayMs`
- Reduce `maxRequestsPerSecond`
- Add delays between batches
