import { testConnection } from './config/database.js';
import app from './server.js';
import { runExtractionBatch } from './workers/extractWorker.js';
import { runCrawlBatch } from './workers/crawlWorker.js';

async function main() {
  console.log('========================================');
  console.log('Leads Generation Backend');
  console.log('GDPR-compliant business contact intelligence engine for Greece');
  console.log('========================================\n');
  console.log('[STARTUP] Backend starting at:', new Date().toISOString());
  console.log('[STARTUP] Node version:', process.version);
  console.log('[STARTUP] Process ID:', process.pid);
  console.log('[STARTUP] Working directory:', process.cwd());
  console.log('');

  // Test database connection on startup
  const connected = await testConnection();
  if (connected) {
    console.log('✓ Database connection successful');
  } else {
    console.error('✗ Database connection failed');
    process.exit(1);
  }

  // Start HTTP server
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const HOST = '0.0.0.0';

  app.listen(PORT, HOST, () => {
    console.log(`🚀 API listening on port ${PORT}`);
  });

  // NOTE: Extraction and crawl workers disabled - only GEMI data is used
  // No website crawling, no Google Places API, no email enrichment
  console.log(`📦 Extraction and crawl workers disabled - only GEMI data is used`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
