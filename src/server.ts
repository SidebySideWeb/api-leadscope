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
app.use('/discovery', discoveryRoutes);

// Businesses routes (requires authentication)
app.use('/businesses', businessesRoutes);

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'leadscop-backend' });
});

export default app;
