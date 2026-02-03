#!/bin/bash

# Diagnostic script for 502 Bad Gateway issues
# Run this on your server: bash diagnose-502.sh

echo "=========================================="
echo "502 Bad Gateway Diagnostic Script"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Check if backend process is running
echo "1. Checking if backend process is running..."
if pgrep -f "node.*index.js\|node.*server.js\|npm.*start" > /dev/null; then
    echo -e "${GREEN}✓ Backend process is running${NC}"
    ps aux | grep -E "node.*index|node.*server|npm.*start" | grep -v grep
else
    echo -e "${RED}✗ Backend process is NOT running${NC}"
fi
echo ""

# 2. Check if port is listening
echo "2. Checking if port 3000 is listening..."
PORT=${PORT:-3000}
if netstat -tlnp 2>/dev/null | grep -q ":$PORT " || ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
    echo -e "${GREEN}✓ Port $PORT is listening${NC}"
    netstat -tlnp 2>/dev/null | grep ":$PORT " || ss -tlnp 2>/dev/null | grep ":$PORT "
else
    echo -e "${RED}✗ Port $PORT is NOT listening${NC}"
fi
echo ""

# 3. Test localhost connection
echo "3. Testing localhost connection..."
if curl -s -f http://localhost:$PORT/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend responds on localhost:$PORT${NC}"
    echo "Response:"
    curl -s http://localhost:$PORT/health | jq . 2>/dev/null || curl -s http://localhost:$PORT/health
else
    echo -e "${RED}✗ Backend does NOT respond on localhost:$PORT${NC}"
    echo "Error details:"
    curl -v http://localhost:$PORT/health 2>&1 | tail -5
fi
echo ""

# 4. Check nginx status
echo "4. Checking nginx status..."
if systemctl is-active --quiet nginx; then
    echo -e "${GREEN}✓ Nginx is running${NC}"
else
    echo -e "${YELLOW}⚠ Nginx is not running${NC}"
fi
echo ""

# 5. Check nginx error logs
echo "5. Recent nginx errors (last 10 lines):"
if [ -f /var/log/nginx/error.log ]; then
    tail -10 /var/log/nginx/error.log | grep -i "502\|bad gateway\|upstream" || echo "No 502 errors in recent logs"
else
    echo "Nginx error log not found"
fi
echo ""

# 6. Check environment variables
echo "6. Checking environment variables..."
if [ -f .env ]; then
    echo "PORT: $(grep PORT .env | cut -d '=' -f2 || echo 'not set')"
    echo "DATABASE_URL: $(grep DATABASE_URL .env | cut -d '=' -f2 | sed 's/:[^:]*@/:***@/' || echo 'not set')"
else
    echo -e "${YELLOW}⚠ .env file not found${NC}"
fi
echo ""

# 7. Check database connection (if DATABASE_URL is set)
echo "7. Testing database connection..."
if [ -f .env ] && grep -q DATABASE_URL .env; then
    source .env
    if timeout 5 psql "$DATABASE_URL" -c "SELECT NOW();" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Database connection successful${NC}"
    else
        echo -e "${RED}✗ Database connection failed${NC}"
    fi
else
    echo -e "${YELLOW}⚠ DATABASE_URL not set, skipping database test${NC}"
fi
echo ""

# 8. Check system resources
echo "8. System resources:"
echo "Memory:"
free -h | grep Mem
echo "Disk:"
df -h / | tail -1
echo ""

# 9. Check recent backend logs
echo "9. Recent backend activity (if using systemd):"
if systemctl list-units --type=service | grep -q "leadscop-backend\|node"; then
    SERVICE=$(systemctl list-units --type=service | grep -E "leadscop-backend|node" | head -1 | awk '{print $1}')
    if [ ! -z "$SERVICE" ]; then
        echo "Service: $SERVICE"
        systemctl status "$SERVICE" --no-pager -n 5 | tail -10
    fi
else
    echo "No systemd service found"
fi
echo ""

# 10. Summary and recommendations
echo "=========================================="
echo "Summary and Recommendations"
echo "=========================================="

if pgrep -f "node.*index.js\|node.*server.js\|npm.*start" > /dev/null && curl -s -f http://localhost:$PORT/health > /dev/null 2>&1; then
    echo -e "${GREEN}Backend appears to be running correctly.${NC}"
    echo "If you're still getting 502 errors, check:"
    echo "  - Nginx configuration (proxy_pass port)"
    echo "  - Firewall rules"
    echo "  - SSL certificate issues"
else
    echo -e "${RED}Backend is NOT running correctly.${NC}"
    echo "Try:"
    echo "  1. Start the backend: npm start"
    echo "  2. Check logs for errors"
    echo "  3. Verify database connection"
    echo "  4. Check environment variables"
fi

echo ""
echo "For detailed troubleshooting, see: TROUBLESHOOTING_502.md"
