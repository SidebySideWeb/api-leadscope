# Vrisko Discovery Queue Optimization

## Overview

The Vrisko discovery system has been optimized with:
- **Database-driven job queue** for reliable, resumable processing
- **Concurrent processing** with configurable concurrency limits
- **Batching** for efficient database operations
- **Progress tracking** for real-time monitoring
- **Automatic retry** on failures

## Architecture

### Job Queue System

```
Discovery Request
    ↓
Discovery Service (creates job)
    ↓
vrisko_discovery_jobs table (database queue)
    ↓
Vrisko Discovery Worker (polls queue)
    ↓
Concurrent Processing (multiple keywords)
    ↓
Batch Processing (businesses in batches)
    ↓
Database Storage
```

### Database Schema

**Table: `vrisko_discovery_jobs`**

- `id` - UUID primary key
- `city_id`, `industry_id`, `dataset_id` - Foreign keys
- `status` - pending | running | completed | failed | cancelled
- `priority` - Higher priority processed first
- `total_keywords`, `completed_keywords` - Progress tracking
- `total_pages`, `completed_pages` - Crawl progress
- `businesses_found`, `businesses_created`, `businesses_updated` - Results
- `error_message`, `retry_count`, `max_retries` - Error handling
- `metadata` - JSONB for keywords, location, etc.

### Key Features

1. **Atomic Job Claiming**
   - Uses `FOR UPDATE SKIP LOCKED` to prevent duplicate processing
   - Multiple workers can run concurrently without conflicts

2. **Concurrent Keyword Processing**
   - Processes multiple keywords in parallel
   - Configurable concurrency via `VRISKO_DISCOVERY_CONCURRENCY`

3. **Batch Database Operations**
   - Processes businesses in batches
   - Configurable batch size via `VRISKO_DISCOVERY_BATCH_SIZE`
   - Reduces database load

4. **Progress Tracking**
   - Real-time updates to job progress
   - Tracks keywords, pages, businesses

5. **Automatic Retry**
   - Failed jobs automatically retry (up to `max_retries`)
   - Exponential backoff between retries

## Setup

### 1. Run Migration

```bash
npm run migrate:vrisko-jobs
```

This creates the `vrisko_discovery_jobs` table.

### 2. Start Worker

```bash
npm run worker:vrisko-discovery
```

Or with PM2:

```bash
pm2 start npm --name "vrisko-discovery-worker" -- run worker:vrisko-discovery
```

### 3. Environment Variables

```env
# Concurrency settings
VRISKO_DISCOVERY_CONCURRENCY=3        # Concurrent keywords per job
VRISKO_DISCOVERY_BATCH_SIZE=5         # Concurrent database operations
VRISKO_DISCOVERY_POLL_INTERVAL=5000   # Poll interval in ms
VRISKO_DISCOVERY_MAX_PAGES=50         # Max pages per keyword
```

## Usage

### API Endpoint

Discovery requests automatically create jobs in the queue:

```bash
POST /discovery/businesses
{
  "city_id": "uuid",
  "industry_id": "uuid",
  "dataset_id": "uuid"
}
```

The job is created immediately and processed asynchronously by the worker.

### Job Management

**Get Job Status:**

```typescript
import { getVriskoDiscoveryJobById } from './db/vriskoDiscoveryJobs.js';

const job = await getVriskoDiscoveryJobById(jobId);
console.log(job.status, job.businesses_created);
```

**Get Job Statistics:**

```typescript
import { getVriskoDiscoveryJobStats } from './db/vriskoDiscoveryJobs.js';

const stats = await getVriskoDiscoveryJobStats();
console.log(stats.pending, stats.running, stats.completed);
```

**Cancel Job:**

```typescript
import { cancelVriskoDiscoveryJob } from './db/vriskoDiscoveryJobs.js';

await cancelVriskoDiscoveryJob(jobId);
```

## Performance Optimization

### Concurrency Tuning

- **Low concurrency (1-2)**: Safer, slower, less likely to be blocked
- **Medium concurrency (3-5)**: Balanced performance and safety
- **High concurrency (10+)**: Faster but higher risk of blocking

### Batch Size Tuning

- **Small batches (1-3)**: Lower database load, slower
- **Medium batches (5-10)**: Balanced
- **Large batches (20+)**: Faster but higher database load

### Polling Interval

- **Fast polling (1-2s)**: Lower latency, higher database load
- **Medium polling (5s)**: Balanced (default)
- **Slow polling (10s+)**: Lower database load, higher latency

## Monitoring

### Job Statistics

Query the database for real-time stats:

```sql
SELECT 
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds
FROM vrisko_discovery_jobs
GROUP BY status;
```

### Progress Tracking

Monitor job progress:

```sql
SELECT 
  id,
  status,
  completed_keywords,
  total_keywords,
  businesses_created,
  businesses_updated
FROM vrisko_discovery_jobs
WHERE status = 'running';
```

## Error Handling

### Automatic Retry

Jobs automatically retry on failure:
- Retry count increments
- Job status set to `pending` if retries remaining
- Job status set to `failed` if max retries reached

### Manual Recovery

Failed jobs can be manually retried:

```sql
UPDATE vrisko_discovery_jobs
SET status = 'pending', retry_count = 0, error_message = NULL
WHERE status = 'failed' AND id = 'job-id';
```

## Scaling

### Multiple Workers

Run multiple worker instances for higher throughput:

```bash
# Worker 1
pm2 start npm --name "vrisko-worker-1" -- run worker:vrisko-discovery

# Worker 2
pm2 start npm --name "vrisko-worker-2" -- run worker:vrisko-discovery
```

The database queue ensures jobs are distributed across workers.

### Priority Queue

Set job priority for important discoveries:

```typescript
await createVriskoDiscoveryJob({
  // ...
  priority: 10, // Higher priority = processed first
});
```

## Benefits

1. **Reliability**: Jobs survive server restarts
2. **Scalability**: Multiple workers can process jobs concurrently
3. **Monitoring**: Real-time progress tracking
4. **Resumability**: Failed jobs can be retried
5. **Performance**: Concurrent processing and batching
6. **Flexibility**: Configurable concurrency and batch sizes
