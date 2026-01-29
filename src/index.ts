import { testConnection } from './config/database.js';
import app from './server.js';

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
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
