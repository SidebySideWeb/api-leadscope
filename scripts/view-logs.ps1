# View server logs
# This script helps you see logs from the running server

Write-Host "Checking for running Node.js processes..." -ForegroundColor Cyan

# Find Node.js processes running the backend
$processes = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*leads-generation*" -or 
    $_.CommandLine -like "*dist/index.js*" -or
    $_.CommandLine -like "*npm start*"
}

if ($processes.Count -eq 0) {
    Write-Host "❌ No backend server process found" -ForegroundColor Red
    Write-Host ""
    Write-Host "To start the server and see logs:" -ForegroundColor Yellow
    Write-Host "  npm start" -ForegroundColor White
    Write-Host ""
    Write-Host "Or run in foreground to see logs:" -ForegroundColor Yellow
    Write-Host "  npm run dev" -ForegroundColor White
    exit 1
}

Write-Host "Found $($processes.Count) Node.js process(es)" -ForegroundColor Green
Write-Host ""
Write-Host "To view logs:" -ForegroundColor Yellow
Write-Host "  1. Check the terminal where you ran 'npm start'" -ForegroundColor White
Write-Host "  2. Or restart the server in foreground:" -ForegroundColor White
Write-Host "     npm run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "To save logs to a file, restart with:" -ForegroundColor Yellow
Write-Host "  npm start > logs.txt 2>&1" -ForegroundColor White
