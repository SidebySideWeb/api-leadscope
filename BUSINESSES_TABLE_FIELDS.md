# Businesses Table - Minimum Required Fields for GEMI Discovery

## Currently Used Fields (Minimum Set)

### Required Fields:
1. **`id`** - UUID primary key (auto-generated)
2. **`ar_gemi`** - VARCHAR(50) UNIQUE - GEMI AR number (required, unique identifier)
3. **`name`** - Business name from `coNamesEn` or `coNameEl` (required)
4. **`dataset_id`** - UUID - Links business to dataset (required)
5. **`owner_user_id`** - UUID - Business owner (required)
6. **`created_at`** - TIMESTAMPTZ (auto-generated)
7. **`updated_at`** - TIMESTAMPTZ (auto-generated)

### Optional Fields (used if available):
8. **`address`** - Business address from GEMI
9. **`postal_code`** - Postal code from GEMI
10. **`municipality_id`** - UUID - Reference to municipalities table
11. **`prefecture_id`** - UUID - Reference to prefectures table
12. **`website_url`** - VARCHAR(500) - Website from GEMI
13. **`discovery_run_id`** - UUID - Links to discovery_run

## Fields NOT Used in GEMI Discovery (Can be removed if not needed elsewhere):

1. **`normalized_name`** - ❌ NOT USED - Made optional via migration
2. **`city_id`** - ❌ REMOVED - No longer exists in table
3. **`industry_id`** - ❌ REMOVED - No longer exists in table (filtered via dataset)
4. **`google_place_id`** - ❌ NOT USED in GEMI discovery
5. **`latitude`** - ❌ NOT USED in GEMI discovery
6. **`longitude`** - ❌ NOT USED in GEMI discovery
7. **`last_discovered_at`** - ❌ NOT USED in GEMI discovery

## Migration to Run:

```bash
# Make normalized_name optional (removes NOT NULL constraint)
npm run migrate:remove-normalized-name-requirement
```

## Notes:

- `normalized_name` is kept for backward compatibility but is no longer required
- Industry filtering is done through `dataset_id` → `datasets.industry_id` relationship
- City filtering is done through `municipality_id` → `municipalities` relationship
- All GEMI businesses use `ar_gemi` as the unique identifier
