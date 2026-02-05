#!/bin/bash
# Check discovery logs to see how many businesses Google Places returned
# Usage: bash scripts/check-discovery-logs.sh [discovery_run_id]

DISCOVERY_RUN_ID=${1:-""}

echo "Checking discovery logs for Google Places API results..."
echo "=================================================="
echo ""

if [ -z "$DISCOVERY_RUN_ID" ]; then
  echo "Getting latest discovery run..."
  DISCOVERY_RUN_ID=$(pm2 logs leadscope-api --lines 1000 --nostream | grep -oP 'discovery_run.*?\K[a-f0-9-]{36}' | head -1)
  echo "Found discovery run: $DISCOVERY_RUN_ID"
  echo ""
fi

echo "Searching logs for Google Places results..."
echo ""

# Search for Google Places API results
pm2 logs leadscope-api --lines 2000 --nostream | grep -E "(RAW GOOGLE PLACES|BEFORE FILTER|AFTER FINAL DEDUP|BUSINESSES TO INSERT|ZERO PLACES)" | tail -50

echo ""
echo "=================================================="
echo ""
echo "Key log messages to look for:"
echo "  - 'RAW GOOGLE PLACES for \"keyword\": X' - Shows places returned per search"
echo "  - 'BEFORE FILTER: X total places from batch' - Total before deduplication"
echo "  - 'AFTER FINAL DEDUP: Unique places: X' - Final count after deduplication"
echo "  - 'BUSINESSES TO INSERT: X' - How many will be inserted"
echo "  - 'ZERO PLACES FROM GOOGLE PLACES API' - Google returned no results"
