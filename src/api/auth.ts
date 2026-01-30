import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getUserByEmail, getUserById, createUser, verifyPassword, hashPassword } from '../db/users.js';
import { generateToken } from '../utils/jwt.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Validation schemas
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

/**
 * Cookie configuration for production
 * domain: '.leadscope.gr' allows cookie to be shared across subdomains
 */
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  domain: '.leadscope.gr', // Shared domain cookie for cross-subdomain access
  path: '/',
  maxAge: 60 * 60 * 24 * 7 * 1000, // 7 days in milliseconds
};

/**
 * POST /api/auth/login
 * Login user and set JWT cookie
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    console.log(`[Auth] Login request from origin: ${req.headers.origin}`);
    
    // Validate input
    const body = loginSchema.parse(req.body);
    const { email, password } = body;

    // Get user
    const user = await getUserByEmail(email);
    if (!user) {
      console.log(`[Auth] Login failed: User not found - ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      console.log(`[Auth] Login failed: Invalid password - ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT with user's plan from database
    const token = generateToken({
      id: user.id,
      email: user.email,
      plan: user.plan,
    });

    // Set cookie with name 'token' to match frontend middleware
    res.cookie('token', token, COOKIE_OPTIONS);

    console.log(`[Auth] Login successful - User ID: ${user.id}, Email: ${user.email}, Plan: ${user.plan}`);
    console.log(`[Auth] Cookie 'token' set with domain '.leadscope.gr'`);

    // Return user info (without password) in format expected by frontend
    return res.json({
      data: {
        id: user.id,
        email: user.email,
        plan: user.plan,
      },
      meta: {
        plan_id: user.plan,
        gated: false,
        total_available: 0,
        total_returned: 0,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('[Auth] Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/register
 * Register new user and set JWT cookie
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    console.log(`[Auth] Register request from origin: ${req.headers.origin}`);
    
    // Validate input
    const body = registerSchema.parse(req.body);
    const { email, password } = body;

    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      console.log(`[Auth] Register failed: User already exists - ${email}`);
      return res.status(409).json({ error: 'User already exists' });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await createUser(email, passwordHash, 'demo');

    // Generate JWT with user's plan from database
    const token = generateToken({
      id: user.id,
      email: user.email,
      plan: user.plan,
    });

    // Set cookie with name 'token' to match frontend middleware
    res.cookie('token', token, COOKIE_OPTIONS);

    console.log(`[Auth] Register successful - User ID: ${user.id}, Email: ${user.email}`);
    console.log(`[Auth] Cookie 'token' set with domain '.leadscope.gr'`);

    // Return user info (without password) in format expected by frontend
    return res.status(201).json({
      data: {
        id: user.id,
        email: user.email,
        plan: user.plan,
      },
      meta: {
        plan_id: user.plan,
        gated: false,
        total_available: 0,
        total_returned: 0,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('[Auth] Register error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/logout
 * Clear JWT cookie
 */
router.post('/logout', (req: Request, res: Response) => {
  console.log(`[Auth] Logout request from origin: ${req.headers.origin}`);
  
  // Clear cookie (use 'token' name to match what was set)
  res.cookie('token', '', {
    ...COOKIE_OPTIONS,
    maxAge: 0, // Expire immediately
  });

    console.log(`[Auth] Logout successful - Cookie cleared`);
    return res.json({ message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 * Get current user info (requires authentication)
 */
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const user = await getUserById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Debug log
    console.log(`[Auth] /me request - User ID: ${user.id}, Email: ${user.email}`);
    console.log(`[Auth] JWT payload ID: ${user.id}`);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        plan: user.plan,
      },
    });
  } catch (error) {
    console.error('[Auth] /me error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
