# How to Edit .env File on Hetzner Server

## Step 1: SSH into Your Server

```bash
ssh deploy@your-server-ip
# or
ssh deploy@your-domain.com
```

## Step 2: Navigate to Backend Directory

```bash
cd ~/apps/leadscop-backend
# or wherever your backend is located
```

## Step 3: Edit .env File

### Option A: Using nano (Easier for beginners)
```bash
nano .env
```

**No `sudo` needed** - You're already logged in as `deploy` user who owns the files.

### Option B: Using vi/vim (If you prefer)
```bash
vi .env
# Press 'i' to enter insert mode
# Make your changes
# Press 'Esc', then type ':wq' to save and quit
```

## Step 4: Update DATABASE_URL

Find the line:
```env
DATABASE_URL=postgresql://postgres.xxxxx:password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
```

Change it to the direct connection (from Supabase Dashboard):
```env
DATABASE_URL=postgresql://postgres.xxxxx:password@db.xxxxx.supabase.co:5432/postgres
```

**Important**: Replace `pooler.supabase.com` with `db.xxxxx.supabase.co` (direct connection)

## Step 5: Save and Exit

### If using nano:
- Press `Ctrl + X` to exit
- Press `Y` to confirm save
- Press `Enter` to confirm filename

### If using vi:
- Press `Esc`
- Type `:wq` and press `Enter`

## Step 6: Restart Backend Service

The method depends on how your backend is running:

### If using PM2:
```bash
pm2 restart leadscop-backend
# or
pm2 restart all
```

### If using systemd service:
```bash
sudo systemctl restart leadscop-backend
# Check status:
sudo systemctl status leadscop-backend
```

### If using npm/node directly:
```bash
# Find the process
ps aux | grep node

# Kill it (replace PID with actual process ID)
kill -9 PID

# Restart (if you have a start script)
npm start
# or
node dist/server.js
```

### If running in screen/tmux:
```bash
# List sessions
screen -ls
# or
tmux ls

# Attach to session
screen -r session-name
# or
tmux attach -t session-name

# Inside session: Ctrl+C to stop, then restart
npm run dev
```

## Step 7: Verify Connection

Check if the backend is running and can connect:
```bash
# Check health endpoint
curl http://localhost:3001/health

# Check logs
pm2 logs leadscop-backend
# or
tail -f ~/apps/leadscop-backend/logs/app.log
# or wherever your logs are
```

Look for:
```
[DATABASE] ✅ RLS is being bypassed (superuser access confirmed)
```

## Quick Reference Commands

```bash
# 1. SSH to server
ssh deploy@your-server

# 2. Go to backend directory
cd ~/apps/leadscop-backend

# 3. Edit .env
nano .env

# 4. Update DATABASE_URL (change pooler to direct connection)

# 5. Save (Ctrl+X, Y, Enter in nano)

# 6. Restart service
pm2 restart leadscop-backend
# OR
sudo systemctl restart leadscop-backend

# 7. Check logs
pm2 logs leadscop-backend --lines 50
```

## Troubleshooting

### Permission Denied?
```bash
# Check file ownership
ls -la .env

# If needed, change owner (replace 'deploy' with your user)
sudo chown deploy:deploy .env
```

### Can't Find .env File?
```bash
# List all files (including hidden)
ls -la

# Find .env file
find ~ -name ".env" -type f 2>/dev/null
```

### Service Won't Restart?
```bash
# Check if service exists
pm2 list
# or
sudo systemctl list-units | grep leadscop

# Check error logs
pm2 logs leadscop-backend --err
# or
sudo journalctl -u leadscop-backend -n 50
```

## Security Note

⚠️ **Never commit `.env` to git** - It contains sensitive credentials!

The `.env` file should already be in `.gitignore`:
```bash
# Verify it's ignored
cat .gitignore | grep .env
```
