import { testConnection } from './config/database.js';
import app from './server.js';
import { runExtractionBatch } from './workers/extractWorker.js';

async function main() {
  console.log('Leads Generation Backend');
  console.log('GDPR-compliant business contact intelligence engine for Greece\n');

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

  // Start extraction worker (processes extraction jobs automatically)
  // Process extraction jobs every 10 seconds
  const EXTRACTION_BATCH_SIZE = parseInt(process.env.EXTRACTION_BATCH_SIZE || '5', 10);
  const EXTRACTION_INTERVAL_MS = parseInt(process.env.EXTRACTION_INTERVAL_MS || '10000', 10); // 10 seconds default

  console.log(`📦 Starting extraction worker (batch size: ${EXTRACTION_BATCH_SIZE}, interval: ${EXTRACTION_INTERVAL_MS}ms)`);

  // Process extraction jobs immediately on startup
  runExtractionBatch(EXTRACTION_BATCH_SIZE).catch(error => {
    console.error('[Extraction Worker] Error in initial batch:', error);
  });

  // Then process periodically
  setInterval(async () => {
    try {
      await runExtractionBatch(EXTRACTION_BATCH_SIZE);
    } catch (error) {
      console.error('[Extraction Worker] Error processing batch:', error);
    }
  }, EXTRACTION_INTERVAL_MS);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
