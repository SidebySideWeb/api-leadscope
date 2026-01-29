# Setup Guide

## Prerequisites

- Node.js 20 or higher
- PostgreSQL database (Supabase)
- Google Maps Places API key

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Install Playwright Browsers

```bash
npx playwright install chromium
```

## Step 3: Configure Environment

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` and set:

- `DATABASE_URL`: Your PostgreSQL connection string
- `GOOGLE_MAPS_API_KEY`: Your Google Maps Places API key

Optional settings:
- `CRAWLER_TIMEOUT`: Timeout in milliseconds (default: 20000)
- `CRAWLER_MAX_PAGES`: Max pages per site (default: 10)
- `DISCOVERY_QUEUE_CONCURRENCY`: Discovery queue concurrency (default: 2)
- `CRAWLER_QUEUE_CONCURRENCY`: Crawler queue concurrency (default: 5)
- `EXTRACTOR_QUEUE_CONCURRENCY`: Extractor queue concurrency (default: 5)
- `QUEUE_RETRY_ATTEMPTS`: Retry attempts (default: 3)

## Step 4: Run Database Migration

Create the `crawl_results` table:

```bash
npm run migrate
```

## Step 5: Verify Database Connection

Test the database connection:

```bash
npm start
```

You should see:
```
✓ Database connection successful
```

## Step 6: Verify Google Maps API

Make sure your Google Maps Places API key has the following APIs enabled:
- Places API
- Places API (New)
- Geocoding API

## Usage Workflow

### 1. Discover Businesses

```bash
npm run discover "restaurant" "Athens"
```

This will:
- Query Google Maps Places API
- Extract business information
- Store businesses in the database
- Create websites and crawl jobs

### 2. Crawl Websites

```bash
npm run crawl 10
```

This will:
- Process pending crawl jobs
- Crawl websites (homepage, /contact, /about, /company, footer links)
- Store HTML content in crawl_results table
- Respect robots.txt

### 3. Extract Contacts

```bash
npm run extract 10
```

This will:
- Read crawl results from database
- Extract emails and phone numbers
- Classify contacts (generic vs personal)
- Create contact records with source tracking

## Troubleshooting

### Database Connection

If you see database connection errors:
1. Verify your `DATABASE_URL` in `.env`
2. Check that your Supabase project is active
3. Ensure your IP is whitelisted (if required)

### Google Maps API Errors

If you see API errors:
1. Verify your API key is correct
2. Check API quotas and billing
3. Ensure required APIs are enabled

### Playwright Errors

If you see Playwright errors:
```bash
npx playwright install chromium
```

### Missing crawl_results Table

If you see errors about missing table:
```bash
npm run migrate
```

## Database Tables

Ensure these tables exist (they should already be created):
- `countries`
- `industries`
- `cities`
- `businesses`
- `websites`
- `contacts`
- `contact_sources`
- `crawl_jobs`
- `crawl_results` (created by migration)

## Next Steps

1. Discover businesses for your target industries and cities
2. Let the crawler process websites
3. Extract contacts from crawled content
4. Query the database for your leads

Example queries:
```sql
-- Get all contacts with sources
SELECT c.*, cs.source_url, cs.page_type
FROM contacts c
JOIN contact_sources cs ON c.id = cs.contact_id;

-- Get businesses by industry
SELECT b.*, i.name as industry_name, ci.name as city_name
FROM businesses b
JOIN industries i ON b.industry_id = i.id
JOIN cities ci ON b.city_id = ci.id
WHERE i.name = 'restaurant';
```
