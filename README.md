# Leads Generation Backend

GDPR-compliant business contact intelligence engine for Greece.

## Overview

This backend system discovers Greek businesses, crawls their websites, and extracts public contact information while maintaining full source tracking for GDPR compliance.

## Features

- **Business Discovery**: Query Google Maps Places API to discover businesses by industry and city
- **Website Crawling**: Safely crawl business websites with robots.txt respect
- **Contact Extraction**: Extract emails and phone numbers from HTML content
- **Source Tracking**: Every contact includes exact source URL and page type
- **Queue System**: Retry-enabled queue system with configurable concurrency
- **City Normalization**: Automatic city name normalization and deduplication
- **Phone Normalization**: Greek phone number normalization to +30 format
- **Email Classification**: Distinguish between generic and personal emails

## Tech Stack

- Node.js 20+
- TypeScript (strict mode)
- PostgreSQL (Supabase)
- Playwright (web crawling)
- Cheerio (HTML parsing)
- Axios (HTTP requests)
- p-queue (queue management)
- dotenv (environment variables)
- zod (validation)

## Security: Row Level Security (RLS)

This project uses Supabase Row Level Security (RLS) to enforce multi-tenancy. See `supabase/README.md` for details.

**API Keys:**
- **Anon Key**: Used by frontend (Next.js dashboard) - enforces RLS policies
- **Service Role Key**: Used by backend (API routes, workers, webhooks) - bypasses RLS

See `supabase/README.md` for complete documentation on RLS policies and API key usage.

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

   Required environment variables:
   - `DATABASE_URL`: PostgreSQL connection string
   - `GOOGLE_MAPS_API_KEY`: Google Maps Places API key
   - `CRAWLER_TIMEOUT`: Crawler timeout in milliseconds (default: 20000)
   - `CRAWLER_MAX_PAGES`: Maximum pages to crawl per site (default: 10)
   - Queue concurrency settings (optional)

3. **Build the project**:
   ```bash
   npm run build
   ```

## Database Schema

The system expects the following tables (already created):
- `countries`
- `industries`
- `cities`
- `businesses`
- `websites`
- `contacts`
- `contact_sources`
- `crawl_jobs`
- `crawl_results` (run `npm run migrate` to create)

**Note**: Run the migration to create the `crawl_results` table:
```bash
npm run migrate
```

## Usage

### Discover Businesses

Discover businesses using Google Maps Places API:

```bash
npm run discover <industry> <city>
```

Examples:
```bash
npm run discover "restaurant" "Athens"
npm run discover "law firm" "Thessaloniki"
npm run discover "restaurant" "" 37.9838 23.7275  # Using coordinates
```

### Crawl Websites

Crawl websites from pending crawl jobs:

```bash
npm run crawl [limit]
```

Example:
```bash
npm run crawl 10  # Process 10 pending crawl jobs
```

### Extract Contacts

Extract contacts from crawled websites:

```bash
npm run extract [limit]
```

Example:
```bash
npm run extract 10  # Extract from 10 completed crawl jobs
```

## Architecture

### Project Structure

```
src/
  config/        # Configuration (database, etc.)
  db/           # Database operations
  queues/       # Queue system
  workers/      # Worker functions
  services/     # External services (Google Maps)
  utils/        # Utility functions
  types/        # TypeScript types
  cli/          # CLI commands
  index.ts      # Main entry point
```

### Workers

1. **Discovery Worker**: Queries Google Maps API, extracts business data, handles city normalization
2. **Crawler Worker**: Crawls websites using Playwright, respects robots.txt, extracts footer links
3. **Extractor Worker**: Extracts emails and phones from HTML, classifies contacts, creates source records

### Queue System

Three queues with configurable concurrency:
- **Discovery Queue**: Concurrency 2 (default)
- **Crawler Queue**: Concurrency 5 (default)
- **Extractor Queue**: Concurrency 5 (default)

All queues support retry with exponential backoff (default: 3 attempts).

## Data Rules

- **Country**: Greece only (GR)
- **City**: Must be structured (cities table)
- **Address**: Free text storage
- **Postal Code**: Stored separately
- **Source Tracking**: Every contact MUST have a contact_sources record
- **Public Data Only**: Only publicly available business data is collected

## GDPR Compliance

- Every extracted contact includes its source URL
- Source tracking includes page type, timestamp, and HTML hash
- No contact exists without a source reference
- Only public business data is collected

## Development

Run in development mode:
```bash
npm run dev
```

Build for production:
```bash
npm run build
```

## Notes

- The system respects robots.txt
- Maximum 10 pages per website (configurable)
- 20 second timeout per page (configurable)
- No PDFs or images/assets are crawled
- HTML content is hashed (SHA256) for deduplication

## Future Enhancements

- Support for all EU countries
- Monthly refresh scheduling
- Advanced deduplication algorithms
- Contact validation and verification
- Rate limiting and API quota management
