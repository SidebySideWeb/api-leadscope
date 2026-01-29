# Dynamic City Coordinate Resolution

## Overview

The system now supports automatic resolution of city coordinates using Google Places API, eliminating the need to hardcode city coordinates.

## Features

- **Automatic coordinate resolution** from city names
- **Database caching** - coordinates are stored and reused
- **Smart radius estimation** based on city type
- **Graceful fallback** if city not found

## How It Works

### 1. Coordinate Resolution Flow

```
User provides city name
    ↓
Check database for existing coordinates
    ↓
If found → Use cached coordinates
    ↓
If not found → Query Google Places API
    ↓
Store in database for future use
    ↓
Use coordinates for geo-grid discovery
```

### 2. Google Places API Search

The system searches for cities using:
- Query: `"{cityName} Greece"`
- Restricts to: `locality`, `administrative_area_level_3`, `administrative_area_level_2`
- Extracts: `location.latitude`, `location.longitude`

### 3. Smart Radius Estimation

Radius is automatically estimated based on city type:

| City Type | Radius |
|-----------|--------|
| `administrative_area_level_2` | 20 km (Regional unit) |
| `administrative_area_level_3` | 15 km (Municipality) |
| `locality` | 12 km (City/town) |
| Default | 10 km |

## Database Schema

New columns added to `cities` table:

```sql
ALTER TABLE cities
ADD COLUMN latitude DECIMAL(10, 8),
ADD COLUMN longitude DECIMAL(11, 8),
ADD COLUMN radius_km DECIMAL(5, 2);
```

## Usage

### CLI - Auto-resolve coordinates

```bash
# Geo-grid discovery with automatic coordinate resolution
npm run discover "restaurant" "Athens" --geo-grid

# The system will:
# 1. Check database for Athens coordinates
# 2. If not found, query Google Places API
# 3. Store coordinates in database
# 4. Use coordinates for geo-grid discovery
```

### CLI - Explicit coordinates (still supported)

```bash
# You can still provide explicit coordinates
npm run discover "restaurant" "Athens" 37.9838 23.7275 15 --geo-grid
```

### Programmatic Usage

```typescript
import { googleMapsService } from './services/googleMaps.js';

// Resolve city coordinates
const coordinates = await googleMapsService.getCityCoordinates('Athens');

if (coordinates) {
  console.log(`Lat: ${coordinates.lat}`);
  console.log(`Lng: ${coordinates.lng}`);
  console.log(`Radius: ${coordinates.radiusKm} km`);
}
```

## API Method

### `getCityCoordinates(cityName: string)`

**Returns:**
```typescript
{
  lat: number;
  lng: number;
  radiusKm: number;
} | null
```

**Example:**
```typescript
const coords = await googleMapsService.getCityCoordinates('Thessaloniki');
// Returns: { lat: 40.6401, lng: 22.9444, radiusKm: 12 }
```

## Database Functions

### Updated Functions

- `createCity()` - Now accepts optional coordinates
- `updateCityCoordinates()` - Updates existing city coordinates
- `getOrCreateCity()` - Can create city with coordinates

### Example

```typescript
import { getOrCreateCity, updateCityCoordinates } from './db/cities.js';

// Create city with coordinates
const city = await getOrCreateCity('Athens', countryId, {
  lat: 37.9838,
  lng: 23.7275,
  radiusKm: 15
});

// Update existing city coordinates
await updateCityCoordinates(city.id, {
  lat: 37.9838,
  lng: 23.7275,
  radiusKm: 15
});
```

## Migration

Run the migration to add coordinate columns:

```bash
npm run migrate:city-coords
```

Or manually:

```bash
npm run migrate add_city_coordinates.sql
```

## Integration

The coordinate resolution is **automatically integrated** into the discovery workflow:

1. **Geo-grid discovery** checks for coordinates in database first
2. If missing, **automatically resolves** from Google Places API
3. **Stores coordinates** for future use
4. **Uses resolved coordinates** for geo-grid discovery

## Error Handling

The system handles errors gracefully:

- **City not found**: Returns `null`, discovery fails with clear error
- **API errors**: Logged, returns `null`
- **Invalid coordinates**: Validated before use

## Benefits

1. **No hardcoding** - City coordinates resolved dynamically
2. **Performance** - Coordinates cached in database
3. **Accuracy** - Uses Google's authoritative data
4. **Flexibility** - Works with any Greek city name
5. **Maintainability** - No manual coordinate updates needed

## Examples

### Discover restaurants in Athens (auto-resolve)

```bash
npm run discover "restaurant" "Athens" --geo-grid
```

Output:
```
🔍 Resolving coordinates for city: Athens
  Fetching coordinates from Google Places API...
✓ Resolved coordinates for Athens: 37.9838, 23.7275 (radius: 12km)
✓ Created city record with coordinates
🌐 Using geo-grid discovery mode
...
```

### Discover law firms in Thessaloniki (cached)

```bash
npm run discover "law firm" "Thessaloniki" --geo-grid
```

Output:
```
🔍 Resolving coordinates for city: Thessaloniki
✓ Found coordinates in database: 40.6401, 22.9444 (radius: 12km)
🌐 Using geo-grid discovery mode
...
```

## Future Enhancements

- [ ] Support for multiple city matches (let user choose)
- [ ] Automatic radius optimization based on business density
- [ ] Support for city aliases/nicknames
- [ ] Batch coordinate resolution for multiple cities
