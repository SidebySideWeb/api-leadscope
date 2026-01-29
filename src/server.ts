import express from 'express';
import cookieParser from 'cookie-parser';
import { corsMiddleware } from './middleware/cors.js';
import authRoutes from './api/auth.js';

const app = express();

// CORS middleware - MUST be before all routes
app.use(corsMiddleware);

// Cookie parser - needed for reading JWT from cookies
app.use(cookieParser());

// JSON body parser
app.use(express.json());

// Auth routes
app.use('/api/auth', authRoutes);

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'leadscop-backend' });
});

export default app;
