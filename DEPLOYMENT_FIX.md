# Server Deployment Fix Instructions

## Critical Issues to Fix:

### 1. Set GEMI_API_KEY (REQUIRED)
Add to `.env` file:
```bash
GEMI_API_KEY=your_actual_api_key_here
GEMI_API_BASE_URL=https://opendata-api.businessportal.gr/api/opendata/v1
```

### 2. Pull Latest Code
The search API fix hasn't been deployed yet.

### 3. Remove Problematic Packages
These are causing errors on startup.

### 4. Rebuild and Restart

## Full Deployment Script:

```bash
cd ~/apps/leadscop-backend

# 1. Pull latest code
git pull origin main

# 2. Remove problematic packages
npm uninstall playwright-extra-plugin-stealth 2>/dev/null || true
rm -rf node_modules/playwright-extra-plugin-stealth

# 3. Install missing dependency (if still using old vrisko crawler)
# If NOT using vrisko anymore, skip this:
# npm install axios-cookiejar-support

# 4. Clean install (if issues persist)
# rm -rf node_modules package-lock.json
# npm install

# 5. Build TypeScript
npm run build

# 6. Verify .env has GEMI_API_KEY
# Edit .env file and add:
# GEMI_API_KEY=your_key_here
# GEMI_API_BASE_URL=https://opendata-api.businessportal.gr/api/opendata/v1

# 7. Restart the service
pm2 restart leadscope-api

# 8. Check logs
pm2 logs leadscope-api --lines 50
```

## What to Look For After Deployment:

✅ **Success indicators:**
- No `GEMI_API_KEY not set` warnings
- No `column m.name does not exist` errors
- `[GEMI] API Response structure:` logs when discovery runs
- `[GEMI] Import completed:` logs showing businesses inserted

❌ **If still failing:**
- Check `.env` file has GEMI_API_KEY
- Verify API key is correct
- Check PM2 logs for specific errors
