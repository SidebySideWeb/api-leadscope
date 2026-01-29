import { Request, Response, NextFunction } from 'express';
import { verifyToken, getTokenFromCookie } from '../utils/jwt.js';
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
 * Verifies JWT token from cookie and attaches user to request
 */
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // Get token from cookie (using cookie-parser)
    const token = getTokenFromCookie(req.cookies, req.headers.cookie);

    if (!token) {
      res.status(401).json({ error: 'Unauthorized: No token provided' });
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
