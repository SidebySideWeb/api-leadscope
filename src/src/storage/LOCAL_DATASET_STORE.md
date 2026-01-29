# Local Dataset Store

Filesystem-based storage for businesses and contacts. Temporary fallback replacing Supabase.

## Overview

The local dataset store provides a simple filesystem-based storage layer for:
- **Businesses**: Stored in `/data/datasets/{datasetId}/businesses.json`
- **Contacts**: Stored in `/data/datasets/{datasetId}/contacts.json`

## Features

- ✅ **Auto-creates directories**: Automatically creates dataset directories as needed
- ✅ **JSON files only**: Simple, readable JSON format
- ✅ **No database usage**: Pure filesystem operations
- ✅ **Graceful degradation**: Returns empty arrays if files don't exist
- ✅ **Date serialization**: Automatically handles Date ↔ ISO string conversion

## File Structure

```
data/
  datasets/
    {datasetId-1}/
      businesses.json
      contacts.json
    {datasetId-2}/
      businesses.json
      contacts.json
```

## API

### Save Businesses

```typescript
import { saveBusinesses } from '../storage/localDatasetStore.js';
import type { Business } from '../types/index.js';

const businesses: Business[] = [
  {
    id: 1,
    name: 'Example Business',
    normalized_name: 'example-business',
    address: '123 Main St',
    postal_code: '12345',
    city_id: 1,
    industry_id: 1,
    google_place_id: 'ChIJ...',
    dataset_id: 'dataset-uuid',
    owner_user_id: 'user-uuid',
    created_at: new Date(),
    updated_at: new Date(),
  },
];

await saveBusinesses('dataset-uuid', businesses);
```

### Load Businesses

```typescript
import { loadBusinesses } from '../storage/localDatasetStore.js';

const businesses = await loadBusinesses('dataset-uuid');
// Returns: Business[] (empty array if file doesn't exist)
```

### Save Contacts

```typescript
import { saveContacts } from '../storage/localDatasetStore.js';
import type { Contact } from '../types/index.js';

const contacts: Contact[] = [
  {
    id: 1,
    email: 'contact@example.com',
    phone: null,
    mobile: null,
    contact_type: 'email',
    is_generic: false,
    first_seen_at: new Date(),
    last_verified_at: new Date(),
    is_active: true,
    created_at: new Date(),
  },
];

await saveContacts('dataset-uuid', contacts);
```

### Load Contacts

```typescript
import { loadContacts } from '../storage/localDatasetStore.js';

const contacts = await loadContacts('dataset-uuid');
// Returns: Contact[] (empty array if file doesn't exist)
```

### Utility Functions

```typescript
// Check if dataset exists
const exists = await datasetExists('dataset-uuid');

// Delete dataset directory
await deleteDataset('dataset-uuid');

// List all dataset IDs
const datasetIds = await listDatasets();
```

## Data Format

### businesses.json

```json
[
  {
    "id": 1,
    "name": "Example Business",
    "normalized_name": "example-business",
    "address": "123 Main St",
    "postal_code": "12345",
    "city_id": 1,
    "industry_id": 1,
    "google_place_id": "ChIJ...",
    "dataset_id": "dataset-uuid",
    "owner_user_id": "user-uuid",
    "created_at": "2025-01-15T10:30:45.123Z",
    "updated_at": "2025-01-15T10:30:45.123Z"
  }
]
```

### contacts.json

```json
[
  {
    "id": 1,
    "email": "contact@example.com",
    "phone": null,
    "mobile": null,
    "contact_type": "email",
    "is_generic": false,
    "first_seen_at": "2025-01-15T10:30:45.123Z",
    "last_verified_at": "2025-01-15T10:30:45.123Z",
    "is_active": true,
    "created_at": "2025-01-15T10:30:45.123Z"
  }
]
```

## Error Handling

- **File doesn't exist**: Returns empty array (graceful degradation)
- **Invalid JSON**: Logs error and returns empty array
- **Directory creation fails**: Throws error
- **Write fails**: Throws error

## Usage Example

```typescript
import {
  saveBusinesses,
  loadBusinesses,
  saveContacts,
  loadContacts,
} from '../storage/localDatasetStore.js';

// Save businesses after discovery
await saveBusinesses(datasetId, discoveredBusinesses);

// Load businesses for export
const businesses = await loadBusinesses(datasetId);

// Save contacts after crawl
await saveContacts(datasetId, extractedContacts);

// Load contacts for export
const contacts = await loadContacts(datasetId);
```

## Migration from Supabase

When Supabase is unavailable:

1. **Discovery Worker**: Save businesses to local store
   ```typescript
   const businesses = await discoverBusinesses(...);
   await saveBusinesses(datasetId, businesses);
   ```

2. **Crawl Worker**: Save contacts to local store
   ```typescript
   const contacts = await extractContacts(...);
   await saveContacts(datasetId, contacts);
   ```

3. **Export Worker**: Load from local store
   ```typescript
   const businesses = await loadBusinesses(datasetId);
   const contacts = await loadContacts(datasetId);
   // Generate export...
   ```

## Benefits

- **No Database Dependency**: Works without Supabase/PostgreSQL
- **Simple**: Easy to inspect and debug (readable JSON files)
- **Portable**: Can easily move/copy datasets between environments
- **Fast**: Direct filesystem access (no network latency)
- **Backup-Friendly**: Easy to backup (just copy `/data` directory)

## Limitations

- **No Transactions**: No atomic operations (save businesses + contacts together)
- **No Concurrency Control**: Multiple processes writing may cause conflicts
- **No Indexing**: Full file read/write (not suitable for very large datasets)
- **No Querying**: Must load entire file to filter/search
- **Temporary**: Intended as fallback, not permanent solution

## Future Migration

When Supabase is available again:

1. Load from local store
2. Bulk insert to database
3. Delete local files
4. Switch back to database queries
