/**
 * Create Super Admin User
 * 
 * Usage:
 *   npm run create-super-admin
 * 
 * Creates a super admin user with:
 * - Email: dgeronikolos@sidebysideweb.gr
 * - Password: !84C*HAaw#D#PxHL
 * - is_internal_user: true (bypasses all limits)
 * - plan: pro
 */

import { pool } from '../config/database.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const ADMIN_EMAIL = 'dgeronikolos@sidebysideweb.gr';
const ADMIN_PASSWORD = '!84C*HAaw#D#PxHL';

/**
 * Hash password using bcrypt
 */
async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

/**
 * Create super admin user
 */
async function createSuperAdmin() {
  try {
    console.log(`\n🔐 Creating super admin user...`);
    console.log(`   Email: ${ADMIN_EMAIL}`);
    
    // 1. Check if user already exists
    const existingUser = await pool.query(
      `SELECT id, email, is_internal_user FROM users WHERE email = $1`,
      [ADMIN_EMAIL]
    );

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      console.log(`\n⚠️  User already exists with email: ${ADMIN_EMAIL}`);
      console.log(`   User ID: ${user.id}`);
      console.log(`   Is Internal User: ${user.is_internal_user}`);
      
      // Update to ensure it's a super admin
      if (!user.is_internal_user) {
        await pool.query(
          `UPDATE users 
           SET is_internal_user = true, 
               plan = 'pro',
               updated_at = NOW()
           WHERE id = $1`,
          [user.id]
        );
        console.log(`\n✅ Updated user to super admin status`);
      } else {
        console.log(`\n✅ User is already a super admin`);
      }
      
      // Update password
      const passwordHash = await hashPassword(ADMIN_PASSWORD);
      await pool.query(
        `UPDATE users 
         SET password_hash = $1, 
             updated_at = NOW()
         WHERE id = $2`,
        [passwordHash, user.id]
      );
      console.log(`✅ Password updated`);
      
      return;
    }

    // 2. Hash password
    console.log(`\n🔒 Hashing password...`);
    const passwordHash = await hashPassword(ADMIN_PASSWORD);
    
    // 3. Generate user ID
    const userId = crypto.randomUUID();
    
    // 4. Insert user
    console.log(`\n💾 Inserting user into database...`);
    const result = await pool.query(
      `INSERT INTO users (
        id,
        email,
        password_hash,
        plan,
        is_internal_user,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 'pro', true, NOW(), NOW())
      RETURNING id, email, plan, is_internal_user`,
      [userId, ADMIN_EMAIL, passwordHash]
    );

    const user = result.rows[0];
    
    console.log(`\n✅ Super admin user created successfully!`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Plan: ${user.plan}`);
    console.log(`   Is Internal User: ${user.is_internal_user}`);
    console.log(`\n📝 You can now log in with:`);
    console.log(`   Email: ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    
  } catch (error: any) {
    console.error(`\n❌ Error creating super admin user:`, error);
    
    if (error.code === '42P01') {
      console.error(`\n⚠️  Users table does not exist. Please run the migration first:`);
      console.error(`   npm run migrate:users`);
    } else {
      throw error;
    }
  } finally {
    await pool.end();
  }
}

// Run if executed directly
createSuperAdmin().catch(console.error);

export { createSuperAdmin };
