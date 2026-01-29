import { pool } from '../config/database.js';
import bcrypt from 'bcryptjs';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  plan: 'demo' | 'starter' | 'pro';
  is_internal_user: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await pool.query<User>(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  return result.rows[0] || null;
}

/**
 * Get user by ID
 */
export async function getUserById(id: string): Promise<User | null> {
  const result = await pool.query<User>(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Create new user
 */
export async function createUser(
  email: string,
  passwordHash: string,
  plan: 'demo' | 'starter' | 'pro' = 'demo'
): Promise<User> {
  const result = await pool.query<User>(
    `INSERT INTO users (email, password_hash, plan, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     RETURNING *`,
    [email.toLowerCase().trim(), passwordHash, plan]
  );
  return result.rows[0];
}

/**
 * Verify password
 */
export async function verifyPassword(
  plainPassword: string,
  hashedPassword: string
): Promise<boolean> {
  return await bcrypt.compare(plainPassword, hashedPassword);
}

/**
 * Hash password
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}
