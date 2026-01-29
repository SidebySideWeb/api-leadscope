# End-to-End Testing Workflow (PowerShell)
# Tests: Discover → Crawl → View → Export → Download

Write-Host "🧪 Starting End-to-End Testing Workflow" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Configuration
$INDUSTRY = "restaurant"
$CITY = "Athens"
$PLAN = "demo"
$USER_ID = "test-user-123"  # Replace with actual user ID

# Step 1: Create dataset ID
Write-Host "`n📊 Step 1: Creating Dataset ID" -ForegroundColor Blue
$DATASET_ID = [guid]::NewGuid().ToString()
Write-Host "Dataset ID: $DATASET_ID"

# Step 2: Discover businesses
Write-Host "`n🔍 Step 2: Discovering Businesses" -ForegroundColor Blue
Write-Host "Running: npm run discover `"$INDUSTRY`" `"$CITY`" `"$DATASET_ID`" --geo-grid"
npm run discover "$INDUSTRY" "$CITY" "$DATASET_ID" --geo-grid

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Discovery failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n⏳ Waiting for discovery to complete..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Step 3: Query businesses (we'll need to do this manually or via a helper script)
Write-Host "`n📋 Step 3: Getting Businesses for Crawling" -ForegroundColor Blue
Write-Host "Note: You'll need to query the database or use the dashboard API to get business IDs"
Write-Host "Example SQL: SELECT id, name, (SELECT url FROM websites WHERE business_id = businesses.id LIMIT 1) as website FROM businesses WHERE dataset_id = '$DATASET_ID' LIMIT 5"

# Step 4: Crawl businesses (manual step - user needs to provide business IDs)
Write-Host "`n🕷️  Step 4: Crawling Businesses" -ForegroundColor Blue
Write-Host "To crawl businesses, run:"
Write-Host "  npm run crawl:simple -- --business-id <id> --website <url> --max-depth 2 --dataset $DATASET_ID --plan $PLAN --user $USER_ID" -ForegroundColor Yellow
Write-Host "`nRun this command 3-5 times with different business IDs"

# Step 5: Export CSV
Write-Host "`n📤 Step 5: Exporting CSV" -ForegroundColor Blue
Write-Host "Running: npm run export:dataset -- --dataset $DATASET_ID --user $USER_ID --plan $PLAN"
npm run export:dataset -- --dataset "$DATASET_ID" --user "$USER_ID" --plan "$PLAN"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Export failed!" -ForegroundColor Red
    exit 1
}

# Step 6: Check export file
Write-Host "`n📁 Step 6: Checking Export File" -ForegroundColor Blue
$EXPORT_DIR = "data\exports\$USER_ID\$DATASET_ID"
if (Test-Path $EXPORT_DIR) {
    Write-Host "✓ Export directory exists: $EXPORT_DIR" -ForegroundColor Green
    Get-ChildItem $EXPORT_DIR | Select-Object -Last 5 | Format-Table Name, Length, LastWriteTime
} else {
    Write-Host "⚠ Export directory not found: $EXPORT_DIR" -ForegroundColor Yellow
}

Write-Host "`n✅ End-to-End Testing Workflow Complete!" -ForegroundColor Green
