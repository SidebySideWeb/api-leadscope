# Stop existing server and restart with logging

Write-Host "Stopping existing Node.js processes..." -ForegroundColor Yellow

# Kill any node processes that might be the backend
# Be careful - this kills ALL node processes
$nodeProcesses = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    $nodeProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "Stopped Node.js processes" -ForegroundColor Green
}

# Create logs directory
$logDir = "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

$logFile = "$logDir/server-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

Write-Host ""
Write-Host "Starting server with logging..." -ForegroundColor Cyan
Write-Host "Logs will be saved to: $logFile" -ForegroundColor Yellow
Write-Host ""
Write-Host "To view logs in real-time in another terminal, run:" -ForegroundColor Yellow
Write-Host "  Get-Content $logFile -Wait -Tail 50" -ForegroundColor White
Write-Host ""

# Start server in background and redirect output
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm start *> '$logFile'; Read-Host 'Press Enter to close'" -WindowStyle Normal

Write-Host "Server started! Check the new window or the log file." -ForegroundColor Green
Write-Host "Log file: $logFile" -ForegroundColor Cyan
