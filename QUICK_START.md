# Quick Start Guide

## Prerequisites

- Node.js 20+
- PostgreSQL database (Supabase)
- Google Maps Places API key

## Setup (One Time)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create `.env` file:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and set:
   - `DATABASE_URL` - Your PostgreSQL connection string
   - `GOOGLE_MAPS_API_KEY` - Your Google Maps API key
   - `PORT` - Server port (default: 3000)

3. **Build the project:**
   ```bash
   npm run build
   ```

## Running the App

### Development Mode (Auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

The API will start on `http://localhost:3000` (or your configured PORT).

## What Runs Automatically

- **API Server**: Handles HTTP requests (discovery, datasets, businesses, etc.)
- **Extraction Worker**: Automatically processes extraction jobs every 10 seconds

## API Endpoints

- `POST /discovery/businesses` - Start a discovery job
- `GET /datasets` - List datasets
- `GET /businesses` - List businesses
- `GET /exports` - List exports

See `README.md` for full API documentation.

## Troubleshooting

**Database connection fails:**
- Check `DATABASE_URL` in `.env`
- Verify database is accessible

**Port already in use:**
- Change `PORT` in `.env` or stop the process using that port

**Build errors:**
- Run `npm install` again
- Check Node.js version: `node --version` (should be 20+)
