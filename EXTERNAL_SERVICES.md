# External Services Used

This document outlines all external services used by the leads generation system and how they're integrated.

## 1. Google Maps Places API

**Purpose**: Primary data source for discovering businesses and finding contact information.

**API Used**: Google Places API (New) v1
- Base URL: `https://places.googleapis.com/v1`
- Authentication: API Key via `X-Goog-Api-Key` header

### Usage

#### A. Business Discovery (`discoveryWorker.ts`)
- **Endpoint**: `POST /places:searchText`
- **Purpose**: Find businesses by industry keywords and city
- **Fields Requested**: 
  - `places.id` (place_id)
  - `places.displayName` (business name)
  - `places.formattedAddress` (address)
  - `places.location` (lat/lng)
  - `places.rating`, `places.userRatingCount`
  - `places.types` (business categories)
  - `places.addressComponents` (for city extraction)
- **Note**: Does NOT fetch website/phone in discovery phase (to save API costs)
- **Language**: Greek (`el`)
- **Region**: Greece (`GR`)
- **Location Bias**: 50km radius circle around city coordinates

#### B. Place Details (`extractWorker.ts`)
- **Endpoint**: `GET /places/{placeId}`
- **Purpose**: Fetch website and phone number (fallback when website crawling fails)
- **Fields Requested**: 
  - `id`, `displayName`, `formattedAddress`
  - `websiteUri` (website URL)
  - `nationalPhoneNumber` (phone)
  - `addressComponents`, `rating`, `userRatingCount`
- **Usage**: Only called if website OR phone is missing after website crawling
- **Cost Optimization**: Avoids unnecessary API calls

#### C. City Coordinates (`googleMaps.ts`)
- **Endpoint**: `POST /places:searchText`
- **Purpose**: Resolve city name to coordinates (lat/lng) and radius
- **Usage**: When city coordinates are missing from database
- **Filters**: Only returns results with types: `locality`, `administrative_area_level_3`, `administrative_area_level_2`
- **Radius Estimation**: 
  - Regional unit: 20km
  - Municipality: 15km
  - City/town: 12km

### Configuration
- **Environment Variable**: `GOOGLE_MAPS_API_KEY`
- **Required**: Yes (throws error if missing)
- **Location**: `src/services/googleMaps.ts`

### Cost Considerations
- **Text Search API**: Used for discovery (cheaper)
- **Place Details API**: Used only as fallback (more expensive)
- **Strategy**: Minimize Place Details calls by prioritizing website crawling

---

## 2. Stripe

**Purpose**: Payment processing and subscription management.

**API Used**: Stripe API v2024-12-18.acacia

### Usage

#### A. Checkout Sessions (`app/api/checkout/route.ts`)
- **Purpose**: Create payment checkout sessions for plan upgrades
- **Modes**: 
  - `subscription` (recurring)
  - `payment` (one-time snapshot)
- **Plans**: Demo, Starter, Pro, Agency
- **Environment Variables**:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_PRICE_STARTER`
  - `STRIPE_PRICE_PROFESSIONAL`
  - `STRIPE_PRICE_AGENCY`

#### B. Webhooks (`app/api/webhooks/stripe/route.ts` & `src/api/webhooks/stripe.ts`)
- **Purpose**: Handle subscription events from Stripe
- **Events Handled**:
  - `checkout.session.completed` - Create subscription record
  - `customer.subscription.updated` - Update subscription status
  - `customer.subscription.deleted` - Cancel subscription
  - `invoice.payment_failed` - Handle payment failures
- **Security**: Webhook signature verification using `STRIPE_WEBHOOK_SECRET`
- **Database**: Updates `subscriptions` table (source of truth for user plans)

#### C. Plan Resolution (`src/db/permissions.ts`)
- **Purpose**: Get user plan from database (populated by Stripe webhooks)
- **Source of Truth**: `subscriptions` table
- **Never Trusts**: Client-provided plan information

### Configuration
- **Environment Variables**:
  - `STRIPE_SECRET_KEY` (required)
  - `STRIPE_WEBHOOK_SECRET` (required for webhooks)
  - `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PROFESSIONAL`, `STRIPE_PRICE_AGENCY` (price IDs)

### Security
- Webhook signature verification prevents unauthorized events
- Database is source of truth (never trust client payload)
- Plan limits enforced server-side

---

## 3. Supabase / PostgreSQL

**Purpose**: Database storage and file storage.

### Database (PostgreSQL)

#### Usage
- **Primary Storage**: All business data, contacts, datasets, users, subscriptions
- **Connection**: Via `DATABASE_URL` environment variable
- **Fallback**: Local JSON files when database unavailable
- **Location**: `src/config/database.ts`

#### Features Used
- **Row Level Security (RLS)**: Enabled for data isolation
- **JSONB Columns**: For flexible data storage (emails, phones, social links)
- **Unique Constraints**: 
  - `google_place_id` (prevents duplicate businesses)
  - `(dataset_id, normalized_name)` (prevents duplicate names per dataset)

### Storage (Supabase Storage)

#### Usage
- **Purpose**: Store export files (CSV exports)
- **Bucket**: `exports` (configurable via `SUPABASE_EXPORTS_BUCKET`)
- **Fallback**: Local filesystem when Supabase unavailable
- **Location**: `src/storage/exportStorage.ts`

#### Configuration
- **Environment Variables**:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (for backend access)
  - `SUPABASE_EXPORTS_BUCKET` (optional, defaults to `exports`)

---

## Service Integration Flow

### Business Discovery Flow
1. **User Request** → Discovery API endpoint
2. **City Resolution** → Google Places API (if coordinates missing)
3. **Business Search** → Google Places Text Search API (multiple keywords)
4. **Deduplication** → By `google_place_id` and website domain
5. **Database Storage** → PostgreSQL (with fallback to local JSON)

### Contact Extraction Flow
1. **Website Crawling** → Native fetch (no external service)
2. **Contact Extraction** → From HTML (emails, phones)
3. **Fallback** → Google Place Details API (if website/phone missing)
4. **Database Storage** → PostgreSQL

### Payment Flow
1. **User Selects Plan** → Frontend calls checkout API
2. **Stripe Checkout** → Redirects to Stripe payment page
3. **Payment Success** → Stripe webhook → Backend updates subscription
4. **Plan Enforcement** → Database query (never trusts client)

---

## Environment Variables Summary

### Required
- `GOOGLE_MAPS_API_KEY` - Google Places API access
- `DATABASE_URL` - PostgreSQL connection string
- `STRIPE_SECRET_KEY` - Stripe API access
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook verification

### Optional (with fallbacks)
- `SUPABASE_URL` - Supabase Storage (falls back to local filesystem)
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase Storage access
- `SUPABASE_EXPORTS_BUCKET` - Export bucket name (defaults to `exports`)

### Stripe Price IDs (Required for checkout)
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_PROFESSIONAL`
- `STRIPE_PRICE_AGENCY`

---

## Cost Optimization Strategies

### Google Maps API
1. **Discovery Phase**: Uses Text Search API (cheaper) - no Place Details
2. **Extraction Phase**: Only calls Place Details if website/phone missing
3. **City Coordinates**: Cached in database, only fetched when missing

### Stripe
- Webhook-based (no polling)
- Database is source of truth (minimizes API calls)

### Database
- Automatic fallback to local storage when database unavailable
- Prevents service disruption

---

## Security Considerations

1. **API Keys**: Stored in environment variables (never in code)
2. **Webhook Verification**: Stripe webhooks verified with signature
3. **Database RLS**: Row-level security for data isolation
4. **Plan Enforcement**: Server-side only (never trusts client)
5. **Source of Truth**: Database for all user plans (populated by webhooks)
