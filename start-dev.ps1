# Start backend on port 3001 for development
# This avoids conflict with Next.js frontend on port 3000

Write-Host "Starting backend on port 3001..." -ForegroundColor Green

# Set port environment variable
$env:PORT = "3001"

# Check if .env file exists
if (-not (Test-Path ".env")) {
    Write-Host "Warning: .env file not found. Database connection may fail." -ForegroundColor Yellow
}

# Start the backend
npm run dev
