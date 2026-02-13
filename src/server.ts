import express from 'express';
import cookieParser from 'cookie-parser';
import { corsMiddleware } from './middleware/cors.js';
import authRoutes from './api/auth.js';
import datasetsRoutes from './api/datasets.js';
import dashboardRoutes from './api/dashboard.js';
import exportsRoutes from './api/exports.js';
import industriesRoutes from './api/industries.js';
import citiesRoutes from './api/cities.js';
import discoveryRoutes from './api/discovery.js';
import businessesRoutes from './api/businesses.js';
import refreshRoutes from './api/refresh.js';
import extractionJobsRoutes from './api/extractionJobs.js';
import stripeWebhooksRoutes from './api/stripeWebhooks.js';
import billingRoutes from './api/billing.js';
import searchRoutes from './api/search.js';
import exportRoutes from './api/export.js';
import metadataRoutes from './api/metadata.js';

const app = express();

// CORS middleware - MUST be before all routes
app.use(corsMiddleware);

// Cookie parser - needed for reading JWT from cookies
app.use(cookieParser());

// JSON body parser
app.use(express.json());

// Auth routes
app.use('/api/auth', authRoutes);

// Public data routes (no auth required)
app.use('/api/industries', industriesRoutes);
app.use('/api/cities', citiesRoutes);

// Datasets routes (requires authentication)
app.use('/datasets', datasetsRoutes);

// Dashboard routes (requires authentication)
app.use('/dashboard', dashboardRoutes);

// Exports routes (requires authentication)
app.use('/exports', exportsRoutes);

// Discovery routes (requires authentication)
app.use('/api/discovery', discoveryRoutes);

// Businesses routes (requires authentication)
app.use('/businesses', businessesRoutes);

// Refresh routes (requires authentication)
app.use('/refresh', refreshRoutes);

// Extraction jobs routes (requires authentication)
app.use('/extraction-jobs', extractionJobsRoutes);

// Stripe webhooks (no auth - uses webhook signature verification)
app.use('/webhooks', stripeWebhooksRoutes);

// Billing routes (requires authentication)
app.use('/billing', billingRoutes);

// Search routes (requires authentication)
app.use('/api/search', searchRoutes);

// Export routes (requires authentication)
app.use('/api/export', exportRoutes);

// Metadata routes (requires authentication)
app.use('/api/metadata', metadataRoutes);

// Health endpoint - enhanced for diagnostics
app.get('/health', async (req, res) => {
  try {
    const { testConnection } = await import('./config/database.js');
    const dbConnected = await testConnection();
    
    res.json({ 
      status: dbConnected ? 'ok' : 'degraded',
      service: 'leadscop-backend',
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      port: process.env.PORT || '3000',
      node_version: process.version
    });
  } catch (error: any) {
    res.status(503).json({ 
      status: 'error',
      service: 'leadscop-backend',
      database: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Root endpoint for basic connectivity test
app.get('/', (req, res) => {
  res.json({ 
    service: 'leadscop-backend',
    status: 'running',
    endpoints: {
      health: '/health',
      api: '/api'
    }
  });
});

export default app;
