#!/bin/bash
# Check PM2 logs for discovery errors
# Run this on the server: bash scripts/check-pm2-logs.sh

echo "Checking PM2 logs for discovery errors..."
echo "=========================================="
echo ""

# Get last 500 lines of PM2 logs
pm2 logs leadscope-api --lines 500 --nostream | grep -E "(discoverBusinessesV2|upsertBusinessGlobal|GoogleMaps|FATAL|ERROR|ZERO PLACES)" | tail -100

echo ""
echo "=========================================="
echo "To see live logs, run: pm2 logs leadscope-api --lines 0"
