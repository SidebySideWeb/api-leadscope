# Troubleshooting 502 Bad Gateway

## Problem
Getting `502 Bad Gateway` when accessing `https://api.leadscope.gr/` but can ping the IP address.

## What 502 Means
A 502 error means:
- ✅ DNS is resolving correctly (you can ping the IP)
- ✅ The reverse proxy (nginx/cloudflare) is receiving requests
- ❌ The reverse proxy **cannot connect** to the backend application

## Diagnostic Steps

### 1. Check if Backend is Running

SSH into your server and check:

```bash
# Check if Node.js process is running
ps aux | grep node

# Check if port 3000 (or your PORT) is listening
netstat -tlnp | grep :3000
# OR
ss -tlnp | grep :3000

# Check systemd service status (if using systemd)
systemctl status leadscop-backend
# OR
pm2 status
```

### 2. Test Backend Directly

```bash
# From the server, test localhost
curl http://localhost:3000/health

# Should return:
# {"status":"ok","service":"leadscop-backend","database":"connected",...}
```

### 3. Check Backend Logs

```bash
# If using systemd
journalctl -u leadscop-backend -n 100 --no-pager

# If using PM2
pm2 logs leadscop-backend --lines 100

# If running directly
# Check the terminal where backend is running
```

### 4. Verify Reverse Proxy Configuration

Check your nginx configuration (usually `/etc/nginx/sites-available/api.leadscope.gr`):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.leadscope.gr;

    location / {
        proxy_pass http://127.0.0.1:3000;  # ← Must match backend port
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

**Common Issues:**
- Wrong port in `proxy_pass` (should be `3000` or whatever `PORT` env var is set)
- Backend not listening on `127.0.0.1` or `0.0.0.0`
- Firewall blocking localhost connections

### 5. Check Environment Variables

```bash
# On the server, check if PORT is set correctly
echo $PORT

# Check .env file
cat .env | grep PORT

# Backend should be listening on the port specified in PORT (default: 3000)
```

### 6. Test Database Connection

The backend requires database connection on startup. Check:

```bash
# Check if database connection is failing
# Look for errors like:
# "✗ Database connection failed"
# "Database connection test failed"
```

### 7. Check Firewall

```bash
# Ensure localhost connections are allowed
iptables -L -n | grep 127.0.0.1

# If using ufw
ufw status
```

### 8. Restart Services

```bash
# Restart backend
systemctl restart leadscop-backend
# OR
pm2 restart leadscop-backend

# Restart nginx
sudo systemctl restart nginx

# Check nginx error logs
sudo tail -f /var/log/nginx/error.log
```

## Quick Fixes

### Fix 1: Backend Not Running
```bash
cd /path/to/leadscop-backend
npm start
# OR
pm2 start npm --name "leadscop-backend" -- start
# OR
systemctl start leadscop-backend
```

### Fix 2: Wrong Port in Nginx
Update nginx config to match backend port:
```nginx
proxy_pass http://127.0.0.1:3000;  # Change if PORT env var is different
```

### Fix 3: Backend Crashing on Startup
Check logs for:
- Database connection errors
- Missing environment variables
- Port already in use

```bash
# Check if port is in use
lsof -i :3000

# Kill process if needed
kill -9 <PID>
```

### Fix 4: Database Connection Issues
```bash
# Test database connection manually
psql $DATABASE_URL -c "SELECT NOW();"

# Check DATABASE_URL in .env
cat .env | grep DATABASE_URL
```

## Health Check Endpoints

Once backend is running, test these:

```bash
# Basic health check
curl http://localhost:3000/health

# Root endpoint
curl http://localhost:3000/

# Through nginx (if working)
curl https://api.leadscope.gr/health
```

## Expected Health Response

```json
{
  "status": "ok",
  "service": "leadscop-backend",
  "database": "connected",
  "timestamp": "2025-01-XX...",
  "uptime": 12345,
  "port": "3000",
  "node_version": "v20.x.x"
}
```

## Common Error Patterns

### Pattern 1: Backend starts then crashes
- **Symptom**: Backend logs show startup then immediate crash
- **Cause**: Database connection failure, missing env vars
- **Fix**: Check database credentials, ensure all env vars are set

### Pattern 2: Backend never starts
- **Symptom**: No process running, no logs
- **Cause**: Service not enabled, wrong working directory
- **Fix**: Check service status, verify working directory

### Pattern 3: Backend runs but nginx can't connect
- **Symptom**: `curl localhost:3000` works, but `curl api.leadscope.gr` returns 502
- **Cause**: Wrong port in nginx config, firewall blocking
- **Fix**: Verify nginx `proxy_pass` port matches backend PORT

### Pattern 4: Intermittent 502s
- **Symptom**: Sometimes works, sometimes 502
- **Cause**: Backend crashing under load, timeout issues
- **Fix**: Check backend logs, increase nginx timeouts, check memory

## Monitoring

Set up monitoring to catch issues early:

```bash
# Add to cron for health checks
*/5 * * * * curl -f http://localhost:3000/health || systemctl restart leadscop-backend
```

## Still Not Working?

1. Check all logs: `journalctl -u leadscop-backend -n 500`
2. Verify nginx config: `sudo nginx -t`
3. Test backend directly: `curl http://localhost:3000/health`
4. Check system resources: `htop`, `df -h`
5. Review recent changes: git log, deployment history
