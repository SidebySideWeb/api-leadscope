import express from 'express';
import { testConnection } from './config/database.js';

const app = express();

// Middleware
app.use(express.json());

// Health endpoint
app.get('/health', async (req, res) => {
  try {
    const connected = await testConnection();
    if (connected) {
      res.json({ status: 'ok', database: 'connected' });
    } else {
      res.status(503).json({ status: 'error', database: 'disconnected' });
    }
  } catch (error) {
    res.status(503).json({ status: 'error', database: 'error' });
  }
});

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

  // Start server
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const HOST = '0.0.0.0';

  app.listen(PORT, HOST, () => {
    console.log(`🚀 API server listening on port ${PORT}`);
  });
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
