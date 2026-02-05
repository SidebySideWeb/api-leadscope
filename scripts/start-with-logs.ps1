# Start server and save logs to file
# This will start the server and save all output to logs/server.log

$logDir = "logs"
$logFile = "$logDir/server.log"

# Create logs directory if it doesn't exist
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
    Write-Host "Created logs directory" -ForegroundColor Green
}

Write-Host "Starting server with logging..." -ForegroundColor Cyan
Write-Host "Logs will be saved to: $logFile" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Start server and redirect output to log file
npm start *> $logFile

# Note: This will block until server stops
# To view logs in real-time, open another terminal and run:
# Get-Content logs/server.log -Wait -Tail 50
