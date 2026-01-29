# UUID Migration Summary

## Overview

The codebase has been refactored to treat `datasetId` as a string UUID everywhere, matching the Supabase database schema where `dataset_id` is a UUID type.

## Changes Made

### 1. Type Definitions Updated

**File: `src/types/index.ts`**
- ✅ `Business.dataset_id`: `number` → `string` (UUID)
- ✅ `DiscoveryInput.datasetId`: `number` → `string` (UUID)

**File: `src/types/jobs.ts`**
- ✅ `DiscoveryJobInput.datasetId`: `number` → `string` (UUID)

**File: `src/types/exports.ts`**
- ✅ `ExportFilters.datasetId`: `number` → `string` (UUID)

**File: `src/db/datasets.ts`**
- ✅ `Dataset.id`: `number` → `string` (UUID)
- ✅ `getDatasetById(datasetId: string)`: Updated signature
- ✅ `verifyDatasetOwnership(datasetId: string)`: Updated signature

### 2. Database Functions Updated

**File: `src/db/businesses.ts`**
- ✅ `getBusinessByGooglePlaceId(google_place_id: string, dataset_id: string)`: Updated to accept UUID
- ✅ `createBusiness(data: { dataset_id: string })`: Updated parameter type

**File: `src/workers/discoveryWorker.ts`**
- ✅ `processPlace(..., datasetId: string, ...)`: Updated function signature

**File: `src/exports/exportService.ts`**
- ✅ `queryExportData(filters: { datasetId?: string })`: Updated parameter type

### 3. CLI Updated

**File: `src/cli/discover.ts`**
- ✅ Removed `parseInt(datasetId)` and `isNaN()` checks
- ✅ Added UUID format validation: `/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/`
- ✅ Updated usage examples to show UUID format
- ✅ `datasetId` remains a string throughout

## UUID Validation

The CLI now validates UUID format:

```typescript
if (!datasetId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(datasetId)) {
  console.error('Error: datasetId must be a valid UUID');
  process.exit(1);
}
```

## Usage

### CLI Command

```bash
# Before (incorrect - numeric ID)
npm run discover "restaurant" "Athens" 1

# After (correct - UUID)
npm run discover "restaurant" "Athens" "550e8400-e29b-41d4-a716-446655440000"
```

### Programmatic Usage

```typescript
await discoverBusinesses({
  industry: 'restaurant',
  city: 'Athens',
  datasetId: '550e8400-e29b-41d4-a716-446655440000' // UUID string
});
```

## Database Queries

All SQL queries now pass UUID strings directly:

```typescript
// ✅ Correct - UUID passed as string
await pool.query(
  'SELECT * FROM datasets WHERE id = $1',
  [datasetId] // UUID string
);

// ❌ Wrong - Never do this
await pool.query(
  'SELECT * FROM datasets WHERE id = $1',
  [parseInt(datasetId)] // Don't parse!
);
```

## Key Principles

1. **UUIDs are strings** - Never cast, parse, or convert them
2. **Direct parameter passing** - Pass UUID strings directly to SQL queries
3. **Type safety** - TypeScript now enforces string type throughout
4. **Validation** - CLI validates UUID format before processing

## Verification

✅ TypeScript compilation: `npm run build` - **PASSED**
✅ No linter errors
✅ All type definitions updated
✅ All function signatures updated
✅ CLI validation added

## Testing

After this migration, running:

```bash
npm run discover "Λογιστικά γραφεία" "Αθήνα" <uuid> --geo-grid
```

Should:
- ✅ Accept UUID string
- ✅ Validate UUID format
- ✅ Pass UUID to database queries
- ✅ Successfully insert businesses
- ✅ Work with exports

## Files Modified

1. `src/types/index.ts` - Type definitions
2. `src/types/jobs.ts` - Job input types
3. `src/types/exports.ts` - Export filter types
4. `src/db/datasets.ts` - Dataset database functions
5. `src/db/businesses.ts` - Business database functions
6. `src/workers/discoveryWorker.ts` - Discovery worker
7. `src/exports/exportService.ts` - Export service
8. `src/cli/discover.ts` - CLI command

## Next Steps

1. **Test discovery** with a valid UUID:
   ```bash
   npm run discover "restaurant" "Athens" "your-uuid-here" --geo-grid
   ```

2. **Verify database** - Check that businesses are inserted:
   ```sql
   SELECT count(*) FROM businesses WHERE dataset_id = 'your-uuid-here';
   ```

3. **Test exports** - Ensure exports work with UUID dataset IDs

## Notes

- The database migration for UUID columns should already be applied in Supabase
- All existing code now treats `datasetId` as a string UUID
- No numeric conversions or parsing remain in the codebase
- Type safety is enforced at compile time
