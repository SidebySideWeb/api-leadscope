import { Request, Response, NextFunction } from 'express';

const ALLOWED_ORIGIN = 'https://www.leadscope.gr';

/**
 * CORS middleware for production
 * Allows cross-origin requests from https://www.leadscope.gr with credentials
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;

  // Debug log
  console.log(`[CORS] Request from origin: ${origin}`);
  console.log(`[CORS] Method: ${req.method}, Path: ${req.path}`);

  // Set CORS headers
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, PATCH, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With'
    );
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  }

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    console.log(`[CORS] Handling OPTIONS preflight request`);
    res.status(200).end();
    return;
  }

  next();
}
