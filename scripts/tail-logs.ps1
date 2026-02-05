# Tail server logs in real-time
# Usage: .\scripts\tail-logs.ps1

$logDir = "logs"
$latestLog = Get-ChildItem -Path $logDir -Filter "server-*.log" -ErrorAction SilentlyContinue | 
    Sort-Object LastWriteTime -Descending | 
    Select-Object -First 1

if (-not $latestLog) {
    Write-Host "❌ No log files found in $logDir" -ForegroundColor Red
    Write-Host ""
    Write-Host "Start the server with logging first:" -ForegroundColor Yellow
    Write-Host "  .\scripts\restart-with-logs.ps1" -ForegroundColor White
    exit 1
}

Write-Host "Tailing log file: $($latestLog.Name)" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Tail the log file
Get-Content $latestLog.FullName -Wait -Tail 50
