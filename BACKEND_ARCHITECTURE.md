# Backend Architecture & API Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [API Endpoints](#api-endpoints)
5. [Services](#services)
6. [Discovery Workflow](#discovery-workflow)
7. [GEMI Integration](#gemi-integration)
8. [Background Workers](#background-workers)
9. [Authentication & Authorization](#authentication--authorization)
10. [Data Flow](#data-flow)

---

## Overview

The backend is a **Node.js/Express.js** application that provides a GDPR-compliant business contact intelligence engine for Greece. It integrates with the **GEMI API** (Greek Business Registry) to fetch and manage business data, with local database caching to optimize performance.

### Key Technologies
- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **Database**: PostgreSQL (via Supabase)
- **ORM**: Raw SQL queries with `pg` client
- **External APIs**: GEMI API (opendata-api.businessportal.gr)
- **Process Manager**: PM2

---

## Architecture

### High-Level Architecture

```
┌─────────────┐
│   Client    │
│  (Frontend) │
└──────┬──────┘
       │ HTTP/REST
       ▼
┌─────────────────────────────────────┐
│         Express.js Server            │
│  ┌───────────────────────────────┐  │
│  │   API Routes (REST Endpoints) │  │
│  └───────────┬───────────────────┘  │
│              │                       │
│  ┌───────────▼───────────────────┐  │
│  │      Service Layer             │  │
│  │  - Discovery Service          │  │
│  │  - GEMI Service               │  │
│  │  - Enrichment Service         │  │
│  │  - Export Service             │  │
│  └───────────┬───────────────────┘  │
│              │                       │
│  ┌───────────▼───────────────────┐  │
│  │   Database Layer (PostgreSQL) │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│      External Services              │
│  - GEMI API                        │
│  - Web Scraping (Playwright)       │
└─────────────────────────────────────┘
```

### Directory Structure

```
src/
├── api/                    # API route handlers
│   ├── discovery.ts       # Discovery endpoints
│   ├── search.ts          # Business search endpoint
│   ├── export.ts          # Data export endpoint
│   └── auth.ts            # Authentication endpoints
├── services/              # Business logic services
│   ├── discoveryService.ts    # Discovery orchestration
│   ├── gemiService.ts         # GEMI API integration
│   ├── enrichmentService.ts   # Contact enrichment
│   └── ...
├── db/                    # Database access layer
│   ├── businesses.ts      # Business queries
│   ├── cities.ts          # City queries
│   ├── industries.ts      # Industry queries
│   └── ...
├── workers/               # Background job workers
│   ├── gemiFetchWorker.ts    # GEMI data fetching
│   └── ...
├── middleware/            # Express middleware
│   ├── cors.ts           # CORS handling
│   ├── auth.ts           # JWT authentication
│   └── ...
└── config/               # Configuration
    └── database.ts        # Database connection
```

---

## Database Schema

### Core Tables

#### `businesses`
Stores business/company information from GEMI API.

```sql
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ar_gemi TEXT UNIQUE NOT NULL,           -- GEMI AR number (unique identifier)
  name TEXT NOT NULL,
  address TEXT,
  postal_code TEXT,
  website_url TEXT,
  
  -- Relationships
  municipality_id UUID REFERENCES municipalities(id),
  prefecture_id UUID REFERENCES prefectures(id),
  city_id UUID REFERENCES cities(id),      -- For backward compatibility
  industry_id UUID REFERENCES industries(id),
  
  -- Metadata
  dataset_id UUID REFERENCES datasets(id),
  owner_user_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Key Constraints:**
- `ar_gemi` is UNIQUE (prevents duplicate businesses from GEMI)
- Foreign keys maintain referential integrity

#### `prefectures`
Greek administrative regions (peripheries).

```sql
CREATE TABLE prefectures (
  id TEXT PRIMARY KEY,                    -- e.g., "pref-1"
  gemi_id TEXT UNIQUE NOT NULL,           -- GEMI API ID
  descr TEXT NOT NULL,                   -- Greek name
  descr_en TEXT,                         -- English name
  last_updated_api TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `municipalities`
Greek municipalities (towns/cities).

```sql
CREATE TABLE municipalities (
  id TEXT PRIMARY KEY,                   -- e.g., "mun-1"
  gemi_id TEXT UNIQUE NOT NULL,           -- GEMI API ID
  prefecture_id TEXT REFERENCES prefectures(id),
  descr TEXT NOT NULL,                   -- Greek name
  descr_en TEXT,                         -- English name
  last_updated_api TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `industries`
Business activity/industry types.

```sql
CREATE TABLE industries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gemi_id INTEGER UNIQUE,                -- GEMI activity ID
  name TEXT UNIQUE NOT NULL,
  discovery_keywords JSONB NOT NULL,     -- Array of search keywords
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### `cities`
City/location data (for backward compatibility with existing system).

```sql
CREATE TABLE cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT UNIQUE NOT NULL,
  country_id UUID REFERENCES countries(id),
  latitude NUMERIC(10, 8),
  longitude NUMERIC(11, 8),
  radius_km NUMERIC(5, 2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `contacts`
Business contact information (email, phone).

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  email TEXT,
  phone TEXT,
  source TEXT,                           -- 'gemi', 'scraped', 'manual'
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `datasets`
User-created datasets for organizing businesses.

```sql
CREATE TABLE datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  last_refreshed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `discovery_runs`
Tracks discovery job executions.

```sql
CREATE TABLE discovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID REFERENCES datasets(id),
  status TEXT DEFAULT 'pending',         -- 'pending', 'running', 'completed', 'failed'
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Relationships

```
users
  └── datasets (1:N)
      └── businesses (1:N)
          └── contacts (1:N)

prefectures (1:N)
  └── municipalities (1:N)
      └── businesses (1:N)

industries (1:N)
  └── businesses (1:N)

cities (1:N)
  └── businesses (1:N)  [backward compatibility]
```

---

## API Endpoints

### Base URL
```
Production: https://api.leadscope.gr
Development: http://localhost:3000
```

### Authentication
Most endpoints require JWT authentication via `Authorization: Bearer <token>` header.

---

### 1. Discovery API

#### `POST /api/discovery`
**Purpose**: Start a discovery job to find businesses for a city and industry.

**Request Body**:
```json
{
  "city_id": "uuid-of-city",
  "industry_id": "uuid-of-industry",
  "dataset_id": "uuid-of-dataset"  // Optional, creates new if not provided
}
```

**Response**:
```json
{
  "data": [{
    "id": "discovery-run-uuid",
    "status": "pending",
    "created_at": "2025-01-15T10:00:00Z"
  }],
  "meta": {
    "plan_id": "pro",
    "gated": false,
    "total_available": 1,
    "message": "Discovery started. Businesses will be available shortly."
  }
}
```

**Workflow**:
1. Validates user authentication
2. Resolves city and industry IDs
3. Creates or reuses dataset
4. Creates discovery_run record
5. **Checks local database first** for existing businesses
6. **If no results found**, calls GEMI API to fetch businesses
7. Imports businesses to database
8. Returns discovery_run ID (async processing)

**Status Codes**:
- `200`: Discovery started successfully
- `400`: Invalid request (missing city_id or industry_id)
- `401`: Unauthorized
- `500`: Server error

---

#### `GET /api/discovery/runs/:runId/results`
**Purpose**: Get results of a discovery run.

**Response**:
```json
{
  "data": {
    "id": "run-uuid",
    "status": "completed",
    "businesses_found": 150,
    "businesses_created": 150,
    "started_at": "2025-01-15T10:00:00Z",
    "completed_at": "2025-01-15T10:05:00Z"
  }
}
```

---

### 2. Search API

#### `GET /api/search`
**Purpose**: Search businesses in local database by filters.

**Query Parameters**:
- `municipality_id` (optional): Filter by municipality
- `industry_id` (optional): Filter by industry
- `prefecture_id` (optional): Filter by prefecture
- `page` (optional, default: 1): Page number
- `limit` (optional, default: 50): Results per page

**Example**:
```
GET /api/search?municipality_id=mun-1&industry_id=uuid&page=1&limit=50
```

**Response**:
```json
{
  "data": [
    {
      "id": "business-uuid",
      "name": "Company Name",
      "address": "123 Main St",
      "municipality": "Athens",
      "industry": "Software Development",
      "website_url": "https://example.com"
    }
  ],
  "meta": {
    "total_count": 150,
    "page": 1,
    "limit": 50,
    "total_pages": 3
  }
}
```

**Implementation**: Queries only local `businesses` table with JOINs to `municipalities`, `industries`, and `prefectures`.

---

### 3. Export API

#### `POST /api/export`
**Purpose**: Export businesses to Excel (.xlsx) file.

**Request Body**:
```json
{
  "municipality_id": "mun-1",      // Optional filters
  "industry_id": "uuid",
  "prefecture_id": "pref-1",
  "start_row": 1,
  "end_row": 100
}
```

**Validation**:
- Maximum export: 1000 rows
- `end_row - start_row <= 1000`

**Pricing Calculation**:
```javascript
const rowCount = end_row - start_row;
const cost = rowCount * EXPORT_PRICE_PER_ROW; // Default: 0.01 per row
```

**Response**:
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- File download with filename: `businesses-export-{timestamp}.xlsx`

**Excel Format**:
- Columns: Name, Address, Municipality, Industry, Website, Email, Phone
- Uses `exceljs` library

**Status Codes**:
- `200`: File generated successfully
- `400`: Invalid request (exceeds max rows, invalid range)
- `401`: Unauthorized
- `500`: Server error

---

### 4. Authentication API

#### `POST /api/auth/login`
**Purpose**: Authenticate user and get JWT token.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "password"
}
```

**Response**:
```json
{
  "token": "jwt-token-string",
  "user": {
    "id": "user-uuid",
    "email": "user@example.com",
    "plan": "pro"
  }
}
```

---

#### `POST /api/auth/register`
**Purpose**: Register new user.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "password",
  "name": "User Name"
}
```

---

## Services

### 1. Discovery Service (`discoveryService.ts`)

**Purpose**: Orchestrates the discovery workflow.

**Main Function**: `runDiscoveryJob(input)`

**Input**:
```typescript
{
  userId: string;
  industry_id: string;      // UUID
  city_id: string;          // UUID
  datasetId?: string;        // Optional, creates new if not provided
  discoveryRunId?: string;   // Optional, uses existing run
}
```

**Workflow**:
1. **Resolve IDs**: Convert city/industry names to IDs if needed
2. **Check Local Database**: Query existing businesses
   ```sql
   SELECT COUNT(*) FROM businesses
   WHERE dataset_id = $1 AND city_id = $2 AND industry_id = $3
   ```
3. **If No Results**:
   - Map city to municipality (by name matching)
   - Get industry `gemi_id` from `industries` table
   - Call `fetchGemiCompaniesForMunicipality()`
   - Call `importGemiCompaniesToDatabase()`
4. **If Results Exist**: Return immediately (no API call)
5. **Create Crawl Jobs**: For websites that need contact enrichment
6. **Return Results**: Summary of businesses found/created

**Returns**:
```typescript
{
  jobId: string;
  businessesFound: number;
  businessesCreated: number;
  businessesUpdated: number;
  errors: string[];
  gated: boolean;  // True if user hit plan limits
}
```

---

### 2. GEMI Service (`gemiService.ts`)

**Purpose**: Handles all interactions with GEMI API.

#### `fetchGemiCompaniesForMunicipality(municipalityGemiId, activityId?)`

**Parameters**:
- `municipalityGemiId`: Number (GEMI municipality ID)
- `activityId`: Optional number (GEMI activity/industry ID)

**Functionality**:
- **Rate Limiting**: 8 requests/minute (7.5 second delay between calls)
- **Pagination**: Automatically fetches all pages
- **API Endpoint**: `GET /companies?municipality_id=X&activity_id=Y&resultsOffset=Z`

**Returns**: Array of `GemiCompany` objects

**Example Response**:
```typescript
{
  ar_gemi: "123456789",
  name: "Company Name",
  municipality_id: 1,
  prefecture_id: 1,
  activity_id: 62010,
  address: "123 Main St",
  website_url: "https://example.com"
}
```

#### `importGemiCompaniesToDatabase(companies, datasetId, userId, cityId?)`

**Parameters**:
- `companies`: Array of `GemiCompany`
- `datasetId`: UUID
- `userId`: UUID
- `cityId`: Optional UUID (for better city mapping)

**Functionality**:
1. For each company:
   - Resolve `municipality_id` from GEMI `municipality_id` (lookup in `municipalities` table)
   - Resolve `prefecture_id` from municipality
   - Resolve `industry_id` from GEMI `activity_id` (lookup in `industries` table)
   - Use provided `cityId` or try to match city by municipality name
2. **Upsert** business using `ar_gemi` as unique constraint:
   ```sql
   INSERT INTO businesses (...) VALUES (...)
   ON CONFLICT (ar_gemi) DO UPDATE SET ...
   ```
3. Track inserted vs updated counts

**Returns**:
```typescript
{
  inserted: number;
  updated: number;
  skipped: number;
}
```

**Rate Limiting Implementation**:
```typescript
class RateLimiter {
  private lastRequestTime: number = 0;
  private pendingRequest: Promise<void> | null = null;

  async acquire(): Promise<void> {
    const delayNeeded = Math.max(0, 7500 - (Date.now() - this.lastRequestTime));
    if (delayNeeded > 0) {
      await new Promise(resolve => setTimeout(resolve, delayNeeded));
    }
    this.lastRequestTime = Date.now();
  }
}
```

---

### 3. Enrichment Service (`enrichmentService.ts`)

**Purpose**: Scrapes business websites to extract missing contact information.

**Main Function**: `enrichBusinessContact(businessId)`

**Workflow**:
1. Get business from database
2. Check if email or phone is missing
3. If `website_url` exists:
   - Use Playwright or Cheerio to scrape website
   - Extract email addresses (regex pattern)
   - Extract phone numbers (regex pattern)
4. Update `contacts` table:
   ```sql
   INSERT INTO contacts (business_id, email, phone, source)
   VALUES ($1, $2, $3, 'scraped')
   ON CONFLICT DO UPDATE SET ...
   ```

**Technologies**:
- **Playwright**: For JavaScript-heavy sites
- **Cheerio**: For static HTML parsing
- **Rate Limiting**: Respects robots.txt and adds delays

---

### 4. Export Service (`export.ts`)

**Purpose**: Generates Excel files from business data.

**Main Function**: `generateExcelExport(filters, startRow, endRow)`

**Implementation**:
```typescript
import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();
const worksheet = workbook.addWorksheet('Businesses');

// Add headers
worksheet.columns = [
  { header: 'Name', key: 'name', width: 30 },
  { header: 'Address', key: 'address', width: 40 },
  // ... more columns
];

// Add data rows
businesses.forEach(business => {
  worksheet.addRow({
    name: business.name,
    address: business.address,
    // ...
  });
});

// Generate buffer
const buffer = await workbook.xlsx.writeBuffer();
```

**Pricing**:
- Calculated as: `(end_row - start_row) * EXPORT_PRICE_PER_ROW`
- Default: `0.01` per row
- Max export: 1000 rows

---

## Discovery Workflow

### Complete Flow Diagram

```
User Request (POST /api/discovery)
    │
    ▼
[1] Validate Authentication
    │
    ▼
[2] Resolve city_id and industry_id
    │
    ▼
[3] Create/Reuse Dataset
    │
    ▼
[4] Create Discovery Run Record
    │
    ▼
[5] Check Local Database
    │
    ├─► [Found Results] ──► Return immediately (no API call)
    │
    └─► [No Results] ──► Continue to GEMI API
            │
            ▼
        [6] Map City to Municipality
            │
            ▼
        [7] Get Industry gemi_id
            │
            ▼
        [8] Call GEMI API
            │
            ├─► Rate Limiter (7.5s delay)
            ├─► Fetch Page 1
            ├─► Fetch Page 2 (if hasMore)
            └─► ... (pagination)
            │
            ▼
        [9] Import to Database
            │
            ├─► Resolve municipality_id
            ├─► Resolve prefecture_id
            ├─► Resolve industry_id
            ├─► Upsert businesses (ar_gemi unique)
            └─► Track inserted/updated
            │
            ▼
        [10] Create Crawl Jobs (for websites)
            │
            ▼
        [11] Return Results
```

### Step-by-Step Example

**Request**:
```json
POST /api/discovery
{
  "city_id": "city-uuid-123",
  "industry_id": "industry-uuid-456"
}
```

**Step 1-4**: Setup (authentication, dataset creation)

**Step 5**: Check Database
```sql
SELECT COUNT(*) FROM businesses
WHERE dataset_id = 'dataset-uuid'
  AND city_id = 'city-uuid-123'
  AND industry_id = 'industry-uuid-456'
```
Result: `0` → No results found

**Step 6**: Map City to Municipality
```sql
-- Get city name
SELECT name FROM cities WHERE id = 'city-uuid-123'
-- Result: "Athens"

-- Find municipality
SELECT id, gemi_id FROM municipalities
WHERE descr ILIKE 'Athens' OR descr_en ILIKE 'Athens'
-- Result: { id: "mun-1", gemi_id: "1" }
```

**Step 7**: Get Industry gemi_id
```sql
SELECT gemi_id FROM industries WHERE id = 'industry-uuid-456'
-- Result: 62010
```

**Step 8**: Call GEMI API
```javascript
fetchGemiCompaniesForMunicipality(1, 62010)
// Rate limiter: wait 7.5s
// GET /companies?municipality_id=1&activity_id=62010&resultsOffset=0
// Response: { data: [...150 companies...], totalCount: 150 }
// Rate limiter: wait 7.5s
// GET /companies?municipality_id=1&activity_id=62010&resultsOffset=100
// Response: { data: [...50 companies...], totalCount: 150 }
// Done (hasMore = false)
```

**Step 9**: Import to Database
```sql
-- For each company:
INSERT INTO businesses (
  ar_gemi, name, municipality_id, prefecture_id, industry_id, ...
) VALUES ('123456789', 'Company Name', 'mun-1', 'pref-1', 'industry-uuid-456', ...)
ON CONFLICT (ar_gemi) DO UPDATE SET ...
```
Result: 150 businesses inserted

**Step 10**: Create Crawl Jobs
```sql
-- For businesses with website_url but no email/phone:
INSERT INTO crawl_jobs (website_id, status) VALUES (...)
```

**Step 11**: Return Results
```json
{
  "businessesFound": 150,
  "businessesCreated": 150,
  "businessesUpdated": 0,
  "searchesExecuted": 2  // 2 API calls (pagination)
}
```

---

## GEMI Integration

### API Configuration

**Base URL**: `https://opendata-api.businessportal.gr/api/opendata/v1`

**Authentication**:
- Method 1: Query parameter `?api_key=...`
- Method 2: Header `X-API-Key: ...`
- Method 3: Header `Authorization: Bearer ...`

**Rate Limits**:
- Maximum: 8 requests per minute
- Implementation: 7.5 second delay between requests

### Endpoints Used

#### 1. Metadata Endpoints

**`GET /metadata/prefectures`**
- Returns: List of all Greek prefectures
- Used by: `seed-gemi-metadata.js` script

**`GET /metadata/municipalities`**
- Returns: List of all Greek municipalities
- Used by: `seed-gemi-metadata.js` script

**`GET /metadata/activities`**
- Returns: List of all business activities/industries
- Used by: `seed-gemi-metadata.js` script

#### 2. Companies Endpoint

**`GET /companies`**

**Query Parameters**:
- `municipality_id` (required): GEMI municipality ID
- `activity_id` (optional): GEMI activity/industry ID
- `resultsOffset` (optional, default: 0): Pagination offset
- `limit` (optional, default: 100): Results per page

**Response Format**:
```json
{
  "data": [
    {
      "ar_gemi": "123456789",
      "name": "Company Name",
      "legal_name": "Legal Company Name",
      "municipality_id": 1,
      "prefecture_id": 1,
      "activity_id": 62010,
      "address": "123 Main St",
      "postal_code": "12345",
      "website_url": "https://example.com",
      "email": "contact@example.com",
      "phone": "+30 210 1234567"
    }
  ],
  "totalCount": 150,
  "resultsOffset": 0,
  "hasMore": true
}
```

**Pagination**:
- Continue fetching until `resultsOffset >= totalCount` or `hasMore = false`
- Safety limit: 10,000 results maximum

### Data Mapping

**GEMI → Database**:

| GEMI Field | Database Table | Database Field |
|------------|---------------|----------------|
| `ar_gemi` | `businesses` | `ar_gemi` (UNIQUE) |
| `name` | `businesses` | `name` |
| `municipality_id` | `municipalities` | `gemi_id` → `id` |
| `prefecture_id` | `prefectures` | `gemi_id` → `id` |
| `activity_id` | `industries` | `gemi_id` → `id` |
| `website_url` | `businesses` | `website_url` |
| `email` | `contacts` | `email` (if provided) |
| `phone` | `contacts` | `phone` (if provided) |

---

## Background Workers

### 1. GEMI Fetch Worker (`gemiFetchWorker.ts`)

**Purpose**: Background job to fetch businesses from GEMI API for a specific municipality.

**Trigger**: Manual or scheduled

**Input**:
```typescript
{
  municipality_gemi_id: number;
  activity_id?: number;
  dataset_id: string;
  user_id: string;
}
```

**Workflow**:
1. Fetch companies from GEMI API
2. Import to database
3. Create crawl jobs for websites

**Status**: Currently not actively used (discovery service handles this on-demand)

---

### 2. Extraction Worker

**Purpose**: Processes extraction jobs to scrape contact information from websites.

**Workflow**:
1. Poll `extraction_jobs` table for pending jobs
2. For each job:
   - Get website URL
   - Scrape using Playwright/Cheerio
   - Extract email and phone
   - Update `contacts` table
3. Mark job as completed

**Interval**: Runs every 10 seconds (configurable)

---

### 3. Crawl Worker

**Purpose**: Processes crawl jobs to fetch website content.

**Workflow**:
1. Poll `crawl_jobs` table for pending jobs
2. For each job:
   - Fetch website HTML
   - Store in `websites` table
   - Create extraction job
3. Mark job as completed

**Interval**: Runs every 30 seconds (configurable)

---

## Authentication & Authorization

### JWT Authentication

**Token Structure**:
```json
{
  "userId": "user-uuid",
  "email": "user@example.com",
  "plan": "pro",
  "iat": 1234567890,
  "exp": 1234571490
}
```

**Middleware**: `src/middleware/auth.ts`

**Usage**:
```typescript
import { authenticate } from './middleware/auth';

app.get('/api/protected', authenticate, (req, res) => {
  const userId = req.userId; // Available after authentication
  // ...
});
```

### User Plans

**Demo Plan**:
- Max datasets: 1
- Max businesses per dataset: 100
- Limited exports

**Starter Plan**:
- Max datasets: 5
- Max businesses per dataset: 1000
- Standard exports

**Pro Plan**:
- Unlimited datasets
- Unlimited businesses
- Full feature access

### Row Level Security (RLS)

Supabase RLS policies ensure users can only access their own data:

```sql
-- Example: Users can only see their own businesses
CREATE POLICY "Users can view own businesses"
ON businesses FOR SELECT
USING (owner_user_id = auth.uid());
```

---

## Data Flow

### Complete Request Lifecycle

```
1. Client Request
   └─► Express Server
       └─► CORS Middleware
           └─► Auth Middleware (if protected)
               └─► Route Handler
                   └─► Service Layer
                       ├─► Database Query
                       └─► External API Call (if needed)
                           └─► Rate Limiter
                               └─► HTTP Request
                                   └─► Response Processing
                                       └─► Database Update
                                           └─► Response to Client
```

### Example: Discovery Request

```
[Client] POST /api/discovery
    │
    ▼
[Express] Parse request body
    │
    ▼
[Auth Middleware] Validate JWT token
    │
    ▼
[Discovery Route] Extract city_id, industry_id
    │
    ▼
[Discovery Service] runDiscoveryJob()
    │
    ├─► [Database] Check existing businesses
    │   └─► If found: Return immediately
    │
    └─► [If not found]
        │
        ├─► [Database] Map city → municipality
        ├─► [Database] Get industry gemi_id
        │
        ▼
        [GEMI Service] fetchGemiCompaniesForMunicipality()
            │
            ├─► [Rate Limiter] Wait 7.5s
            ├─► [HTTP] GET /companies?municipality_id=1&activity_id=62010
            ├─► [Rate Limiter] Wait 7.5s
            ├─► [HTTP] GET /companies?municipality_id=1&activity_id=62010&resultsOffset=100
            └─► [Return] Array of companies
            │
            ▼
        [GEMI Service] importGemiCompaniesToDatabase()
            │
            ├─► [Database] Resolve municipality_id
            ├─► [Database] Resolve prefecture_id
            ├─► [Database] Resolve industry_id
            ├─► [Database] INSERT/UPDATE businesses (ar_gemi unique)
            └─► [Return] { inserted, updated, skipped }
            │
            ▼
        [Discovery Service] Create crawl jobs
            │
            └─► [Database] INSERT INTO crawl_jobs
                │
                ▼
        [Response] Return discovery_run ID
            │
            ▼
[Client] Receives response
```

---

## Error Handling

### Common Error Scenarios

1. **GEMI API Rate Limit Exceeded**
   - **Handling**: Rate limiter prevents this
   - **Fallback**: Queue request for later

2. **Municipality Not Found**
   - **Handling**: Log warning, skip GEMI fetch
   - **Response**: Return error message to user

3. **Database Connection Error**
   - **Handling**: Retry with exponential backoff
   - **Fallback**: Return 500 error

4. **Invalid City/Industry ID**
   - **Handling**: Validate before processing
   - **Response**: Return 400 Bad Request

### Error Response Format

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional context"
  }
}
```

---

## Performance Optimizations

1. **Local Database Caching**: Check DB before API calls
2. **Rate Limiting**: Prevents API overload
3. **Connection Pooling**: Reuses database connections
4. **Batch Processing**: Processes multiple records efficiently
5. **Indexes**: Database indexes on frequently queried columns
   - `businesses.ar_gemi` (UNIQUE)
   - `businesses.municipality_id`
   - `businesses.industry_id`
   - `businesses.city_id`

---

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# GEMI API
GEMI_API_BASE_URL=https://opendata-api.businessportal.gr/api/opendata/v1
GEMI_API_KEY=your_api_key_here

# JWT
JWT_SECRET=your_secret_key

# Export Pricing
EXPORT_PRICE_PER_ROW=0.01

# Server
PORT=3000
```

---

## Summary

The backend follows a **service-oriented architecture** with clear separation of concerns:

- **API Layer**: Handles HTTP requests/responses
- **Service Layer**: Contains business logic
- **Database Layer**: Data persistence
- **External Integration**: GEMI API with rate limiting

**Key Features**:
- ✅ Local database caching (avoids unnecessary API calls)
- ✅ Automatic pagination for GEMI API
- ✅ Rate limiting (8 requests/minute)
- ✅ Unique constraint on `ar_gemi` (prevents duplicates)
- ✅ On-demand discovery (fetches only when needed)
- ✅ Excel export with pricing
- ✅ Contact enrichment via web scraping
- ✅ GDPR-compliant data handling

This architecture ensures **scalability**, **reliability**, and **efficiency** while maintaining data integrity and respecting API rate limits.
