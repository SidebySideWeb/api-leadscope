# 🚨 EMERGENCY: Stop Jobs to Prevent Google Places API Costs

## Problem
Excessive Google Places API calls are causing high costs. The monthly limit was exceeded in 2 days.

## Quick Actions

### 1. Check What Jobs Are Running
```bash
npm run check:jobs
```

This will show:
- How many extraction jobs are pending/running (these call `getPlaceDetails` - $0.017 per call)
- How many discovery runs are pending/running (these call `searchPlaces` - $0.032 per call)
- Estimated API costs
- Recent jobs that will make API calls

### 2. Stop All Running Jobs
```bash
npm run stop:jobs --confirm
```

This will:
- Mark all pending/running extraction jobs as `failed`
- Mark all pending/running crawl jobs as `failed`
- Mark all pending/running discovery runs as `failed`

**⚠️ WARNING:** This stops ALL jobs. Workers may still process jobs that were already started. Consider restarting workers after stopping jobs.

### 3. Restart Workers (on server)
```bash
pm2 restart leadscope-api
# or restart specific workers
pm2 restart extractWorker
pm2 restart discoveryWorker
```

## Root Cause Analysis

### Where Google Places API is Called:

1. **`extractWorker.ts`** - Calls `getPlaceDetails()` when:
   - Crawling fails (no pages found)
   - Phone number not found from crawling
   - Website not found from crawling
   - **FIXED:** Now checks database first to avoid duplicate calls

2. **`discoveryWorkerV2.ts`** - Calls `searchPlaces()` for:
   - Each keyword search at each grid point
   - Can make thousands of calls per discovery run

3. **`businessSyncService.ts`** - Calls `getPlaceDetails()` for:
   - Monthly business refresh/sync

## Cost Breakdown

- **Place Details API**: $0.017 per call
- **Text Search API**: $0.032 per call

If you have:
- 1000 pending extraction jobs = $17.00
- 100 running discovery searches = $3.20
- **Total potential cost: $20.20**

## Prevention Measures

### Already Implemented:
1. ✅ Check if business already has email AND phone before processing extraction job
2. ✅ Check if business already has website/phone in DB before calling Place Details
3. ✅ Scripts to check and stop jobs

### Recommended:
1. Add rate limiting to Place Details calls
2. Add daily/monthly budget limits
3. Cache Place Details results
4. Monitor API usage in real-time

## Next Steps

1. **Immediately**: Run `npm run check:jobs` to see current state
2. **If needed**: Run `npm run stop:jobs --confirm` to stop all jobs
3. **Review**: Check logs to see which jobs were making excessive calls
4. **Fix**: Deploy the improved `extractWorker.ts` that checks DB before calling API
5. **Monitor**: Set up alerts for API usage
