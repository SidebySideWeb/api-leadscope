# Error Logging System

## Overview
Comprehensive error logging has been added throughout the backend to diagnose database connection issues, RLS policy violations, and data persistence problems.

## Error Categories Logged

### 1. RLS Policy Violations (Error Code: 42501)
- **What it means**: Row Level Security policy is blocking the operation
- **Where logged**: All database INSERT/UPDATE operations
- **Action**: Check RLS policies on the affected table

### 2. Foreign Key Violations (Error Code: 23503)
- **What it means**: Referenced record doesn't exist
- **Where logged**: Contact sources, websites, etc.
- **Action**: Verify parent records exist before inserting

### 3. Unique Constraint Violations (Error Code: 23505)
- **What it means**: Duplicate key violation
- **Where logged**: All unique constraint checks
- **Action**: Check for duplicate data

### 4. Table Not Found (Error Code: 42P01)
- **What it means**: Table doesn't exist
- **Where logged**: All table operations
- **Action**: Run migrations to create missing tables

### 5. Database Connection Errors
- **Error Codes**: 08006, 57P01, 57P02, 57P03
- **What it means**: Connection pool issues, database unavailable
- **Where logged**: Connection pool events, all queries
- **Action**: Check database connection string, network, database status

## Logging Locations

### Database Operations
- `src/db/contacts.ts` - Contact creation
- `src/db/contactSources.ts` - Contact source linking
- `src/db/websites.ts` - Website creation
- `src/config/database.ts` - Connection pool events

### Worker Operations
- `src/workers/extractWorker.ts` - Extraction job processing
  - Contact extraction from websites
  - Place Details API calls
  - Website crawling
  - Social media extraction

## Log Format

All errors include:
- Error code (PostgreSQL error code)
- Error message
- Error detail (if available)
- Error hint (if available)
- Constraint name (if applicable)
- Table name
- Schema name
- SQL query (sanitized)
- Parameters (sanitized)

## Example Log Output

```
[createContact] RLS POLICY VIOLATION - Permission denied: {
  code: '42501',
  message: 'new row violates row-level security policy',
  detail: 'Policy "Users can insert contacts" failed',
  table: 'contacts',
  ...
}
```

## Database Connection Monitoring

The connection pool now logs:
- New client connections
- Client acquisitions
- Client removals
- Connection errors

## RLS Status Check

On startup, the system checks RLS status on key tables:
- contacts
- contact_sources
- websites
- businesses
- extraction_jobs

## Fixes Applied

1. **Contact Sources Business Linking**: Added `business_id` parameter to `createContactSource()` to properly link contacts to businesses
2. **Error Context**: All database operations now log full error context
3. **Connection Pool Monitoring**: Added event handlers for connection lifecycle
4. **RLS Diagnostics**: Startup check for RLS status on critical tables

## Debugging Steps

1. **Check startup logs** for RLS status and connection success
2. **Look for RLS violations** (code 42501) - indicates policy blocking
3. **Check foreign key errors** (code 23503) - missing parent records
4. **Monitor connection errors** - database availability issues
5. **Review extraction worker logs** - see which step fails

## Common Issues

### Contacts Not Being Created
- Check RLS policies on `contacts` table
- Verify user has INSERT permission
- Check foreign key constraints

### Contact Sources Not Linking
- Verify `contact_sources` table has `business_id` column
- Check RLS policies allow INSERT with business_id
- Verify contact_id exists

### Websites Not Being Created
- Check RLS policies on `websites` table
- Verify business_id exists and is accessible
- Check for unique constraint violations
