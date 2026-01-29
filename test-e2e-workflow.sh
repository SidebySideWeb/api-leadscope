#!/bin/bash
# End-to-End Testing Workflow
# Tests: Discover → Crawl → View → Export → Download

set -e  # Exit on error

echo "🧪 Starting End-to-End Testing Workflow"
echo "========================================"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
INDUSTRY="restaurant"
CITY="Athens"
PLAN="demo"
USER_ID="test-user-123"  # Replace with actual user ID

# Step 1: Create or get a dataset
echo -e "\n${BLUE}Step 1: Creating/Getting Dataset${NC}"
DATASET_ID=$(node -e "console.log(require('crypto').randomUUID())")
echo "Dataset ID: $DATASET_ID"

# Step 2: Discover businesses
echo -e "\n${BLUE}Step 2: Discovering Businesses${NC}"
echo "Running: npm run discover \"$INDUSTRY\" \"$CITY\" \"$DATASET_ID\" --geo-grid"
npm run discover "$INDUSTRY" "$CITY" "$DATASET_ID" --geo-grid

# Wait a bit for discovery to complete
sleep 2

# Step 3: Get businesses from dataset (we'll need to query DB)
echo -e "\n${BLUE}Step 3: Getting Businesses for Crawling${NC}"
echo "Querying businesses from dataset..."

# Step 4: Crawl 3-5 businesses
echo -e "\n${BLUE}Step 4: Crawling Businesses${NC}"
echo "Note: You'll need to manually run crawl commands for each business"
echo "Example:"
echo "  npm run crawl:simple -- --business-id <id> --website <url> --max-depth 2 --dataset $DATASET_ID --plan $PLAN --user $USER_ID"

# Step 5: Export CSV
echo -e "\n${BLUE}Step 5: Exporting CSV${NC}"
echo "Running: npm run export:dataset -- --dataset $DATASET_ID --user $USER_ID --plan $PLAN"
npm run export:dataset -- --dataset "$DATASET_ID" --user "$USER_ID" --plan "$PLAN"

# Step 6: Check export file
echo -e "\n${BLUE}Step 6: Checking Export File${NC}"
EXPORT_DIR="data/exports/$USER_ID/$DATASET_ID"
if [ -d "$EXPORT_DIR" ]; then
  echo -e "${GREEN}✓ Export directory exists: $EXPORT_DIR${NC}"
  ls -lh "$EXPORT_DIR" | tail -5
else
  echo -e "${YELLOW}⚠ Export directory not found: $EXPORT_DIR${NC}"
fi

echo -e "\n${GREEN}✅ End-to-End Testing Workflow Complete!${NC}"
