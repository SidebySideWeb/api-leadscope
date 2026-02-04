# Cost Estimation in Discovery

## Overview

The discovery flow has been extended to provide cost estimation **without charging users**. This allows users to preview export and refresh costs before committing to payment.

## Key Principles

1. **ESTIMATES ONLY** - No billing occurs during discovery
2. **No Side Effects** - Discovery logic unchanged, no credits deducted
3. **Transparent** - Clear indication that prices are estimates, not guarantees

## Implementation

### 1. DiscoveryResult Extension

The `DiscoveryResult` interface now includes:

```typescript
{
  estimatedBusinesses: number;
  completenessStats: {
    withWebsitePercent: number;
    withEmailPercent: number;
    withPhonePercent: number;
  };
  exportEstimates: Array<{
    size: number;
    priceEUR: number;
  }>;
  refreshEstimates: {
    incompleteOnly: {
      pricePerBusinessEUR: number;
      estimatedTotalEUR: number;
    };
    fullRefresh: {
      pricePerBusinessEUR: number;
      estimatedTotalEUR: number;
    };
  };
}
```

### 2. Pricing Configuration

Pricing rules are defined in `src/config/pricing.ts`:

**Export Pricing:**
- 50 businesses: €9
- 100 businesses: €15
- 500 businesses: €49
- 1,000 businesses: €79
- 2,000 businesses: €129

**Refresh Pricing:**
- Incomplete only: €0.05 per business
- Full refresh: €0.03 per business (bulk discount)

### 3. Estimation Logic

**Estimated Businesses:**
- Uses `uniqueBusinessesDiscovered` from discovery result

**Completeness Stats:**
- Website: Calculated from Google Places response (if available)
- Phone: Calculated from Google Places response (if available)
- Email: Estimated at 25% (requires extraction/crawling, not in Google Places)

**Export Estimates:**
- Only includes tiers ≤ `estimatedBusinesses`
- Filtered automatically by `calculateExportEstimates()`

**Refresh Estimates:**
- Incomplete only: `estimatedBusinesses × incompleteRate × 0.05`
- Full refresh: `estimatedBusinesses × 0.03`
- Default incomplete rate: 30% (conservative estimate)

### 4. Storage

Cost estimates are stored in `discovery_runs.cost_estimates` (JSONB column):

- Stored when discovery completes (success or failure)
- Available via API endpoints
- Parsed automatically on retrieval

### 5. API Endpoints

**GET /discovery/runs/:runId/results**
- Returns discovery run with cost estimates
- Requires authentication and dataset ownership
- Returns `null` for `cost_estimates` if not yet available

**GET /refresh?dataset_id=:datasetId**
- Returns discovery runs with cost estimates included
- Updated to include `cost_estimates` field

## Database Migration

Run migration to add `cost_estimates` column:

```sql
-- See: src/db/migrations/add_cost_estimates_to_discovery_runs.sql
ALTER TABLE discovery_runs
ADD COLUMN IF NOT EXISTS cost_estimates JSONB;
```

## Usage Example

```typescript
// Discovery completes
const result = await discoverBusinessesV2(input, discoveryRunId);

// Estimates are automatically calculated and stored
console.log(result.estimatedBusinesses); // e.g., 150
console.log(result.exportEstimates); // Available tiers
console.log(result.refreshEstimates); // Refresh costs

// Retrieve via API
GET /discovery/runs/{runId}/results
{
  "data": {
    "id": "...",
    "status": "completed",
    "cost_estimates": {
      "estimatedBusinesses": 150,
      "completenessStats": {
        "withWebsitePercent": 65.5,
        "withEmailPercent": 25.0,
        "withPhonePercent": 78.2
      },
      "exportEstimates": [
        { "size": 50, "priceEUR": 9 },
        { "size": 100, "priceEUR": 15 }
      ],
      "refreshEstimates": {
        "incompleteOnly": {
          "pricePerBusinessEUR": 0.05,
          "estimatedTotalEUR": 2.25
        },
        "fullRefresh": {
          "pricePerBusinessEUR": 0.03,
          "estimatedTotalEUR": 4.50
        }
      }
    }
  }
}
```

## Important Notes

1. **No Billing**: These are estimates only. Actual billing occurs during export/refresh, not discovery.

2. **Completeness Estimates**: 
   - Website/phone percentages are based on Google Places response
   - Email percentage is estimated (25% default) since it requires extraction

3. **Incomplete Rate**: Default 30% is conservative. Actual rate may vary by industry/city.

4. **Future Extensibility**: Pricing configuration can be moved to database or external service without changing the interface.

## Testing

To test cost estimation:

1. Run discovery for a city/industry
2. Wait for discovery to complete
3. Query `/discovery/runs/{runId}/results`
4. Verify `cost_estimates` contains expected structure
5. Verify export estimates only include valid tiers
6. Verify refresh estimates are calculated correctly

## Future Enhancements

- Dynamic pricing based on industry/city
- Historical completeness data for better estimates
- A/B testing different pricing tiers
- Real-time pricing updates from external service
