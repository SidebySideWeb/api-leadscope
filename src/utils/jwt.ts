import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Warn if using default secret in production
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('⚠️  WARNING: JWT_SECRET not set! Using default secret. This is insecure!');
}

export interface JWTPayload {
  id: string;
  email: string;
  plan?: 'demo' | 'starter' | 'pro' | 'snapshot' | 'professional' | 'agency';
}

/**
 * Generate JWT token
 */
export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    console.error('[JWT] Token verification failed:', error);
    return null;
  }
}

/**
 * Get JWT from Authorization Bearer header
 * Expected format: Authorization: Bearer <token>
 */
export function getTokenFromAuthorizationHeader(authHeader?: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  // Check for Bearer token format
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  return null;
}

/**
 * Get JWT from cookie
 * Can be used with cookie-parser (req.cookies) or raw cookie header
 * Checks for 'token' cookie name (matches frontend middleware)
 * NOTE: This is for backward compatibility - prefer Authorization header for API requests
 */
export function getTokenFromCookie(
  cookies: { [key: string]: string } | undefined,
  cookieHeader?: string | undefined
): string | null {
  // Try cookie-parser first (preferred)
  if (cookies && cookies['token']) {
    return cookies['token'];
  }

  // Fallback to manual parsing
  if (cookieHeader) {
    const cookieStrings = cookieHeader.split(';').map(c => c.trim());
    const tokenCookie = cookieStrings.find(c => c.startsWith('token='));
    
    if (tokenCookie) {
      return tokenCookie.split('=')[1] || null;
    }
  }

  return null;
}
