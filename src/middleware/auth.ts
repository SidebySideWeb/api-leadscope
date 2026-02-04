import { Request, Response, NextFunction } from 'express';
import { verifyToken, getTokenFromAuthorizationHeader, getTokenFromCookie } from '../utils/jwt.js';
import { getUserById } from '../db/users.js';

export interface AuthRequest extends Request {
  userId?: string;
  user?: {
    id: string;
    email: string;
  };
}

/**
 * Authentication middleware
 * Verifies JWT token from Authorization Bearer header (preferred) or cookie (fallback)
 * For API requests, use: Authorization: Bearer <token>
 */
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // CRITICAL: Prefer Authorization Bearer header for API requests
    // Fallback to cookie for backward compatibility (web requests)
    const authHeader = req.headers.authorization;
    let token = getTokenFromAuthorizationHeader(authHeader);
    
    // Fallback to cookie if no Authorization header
    if (!token) {
      token = getTokenFromCookie(req.cookies, req.headers.cookie);
    }

    if (!token) {
      res.status(401).json({ error: 'Unauthorized: No token provided. Use Authorization: Bearer <token> header or token cookie' });
      return;
    }

    // Verify token
    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return;
    }

    // Verify user exists
    const user = await getUserById(payload.id);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized: User not found' });
      return;
    }

    // Attach user info to request
    req.userId = payload.id;
    req.user = {
      id: user.id,
      email: user.email,
    };

    // Debug log
    console.log(`[Auth] Authenticated user - ID: ${user.id}, Email: ${user.email}`);

    next();
  } catch (error) {
    console.error('[Auth] Middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
}
