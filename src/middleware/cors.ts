import { Request, Response, NextFunction } from 'express';

const ALLOWED_ORIGINS = [
  'https://www.leadscope.gr',
  'https://leadscope.gr',
  'http://localhost:3000', // For local development
];

/**
 * CORS middleware for production
 * Allows cross-origin requests from leadscope.gr domains with credentials
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;

  // Debug log
  console.log(`[CORS] Request from origin: ${origin}`);
  console.log(`[CORS] Method: ${req.method}, Path: ${req.path}`);

  // Handle preflight OPTIONS requests FIRST
  if (req.method === 'OPTIONS') {
    // Set CORS headers for OPTIONS requests from allowed origins
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, PATCH, OPTIONS'
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, Accept, Origin'
      );
      res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
      console.log(`[CORS] OPTIONS preflight allowed for origin: ${origin}`);
      res.status(200).end();
      return;
    } else if (origin) {
      console.warn(`[CORS] OPTIONS preflight blocked for unauthorized origin: ${origin}`);
      res.status(403).json({ error: 'CORS policy: Origin not allowed' });
      return;
    } else {
      // No origin header - might be same-origin request, allow it
      res.status(200).end();
      return;
    }
  }

  // Set CORS headers for actual requests from allowed origins
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, PATCH, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, Accept, Origin'
    );
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  } else if (origin) {
    // Log blocked origins for security monitoring
    console.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
  }

  next();
}
