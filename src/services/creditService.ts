/**
 * Credit Service
 * 
 * Manages user credits:
 * - Get current credit balance
 * - Add credits (subscription, manual)
 * - Consume credits (operations)
 * - Assert credits available
 */

import { pool } from '../config/database.js';
import { isInternalUser } from '../db/subscriptions.js';

export interface CreditTransaction {
  id: string;
  user_id: string;
  amount: number;
  reason: string;
  reference_id: string | null;
  created_at: Date;
}

/**
 * Get current credit balance for a user
 * Credits = sum of all credit_transactions.amount
 */
export async function getUserCredits(userId: string): Promise<number> {
  // Internal users have unlimited credits
  const isInternal = await isInternalUser(userId);
  if (isInternal) {
    return Number.MAX_SAFE_INTEGER;
  }

  const result = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM credit_transactions
     WHERE user_id = $1`,
    [userId]
  );

  return parseInt(result.rows[0]?.total || '0', 10);
}

/**
 * Add credits to user account
 */
export async function addCredits(
  userId: string,
  amount: number,
  reason: string,
  referenceId?: string
): Promise<CreditTransaction> {
  if (amount <= 0) {
    throw new Error('Credit amount must be positive');
  }

  const result = await pool.query<CreditTransaction>(
    `INSERT INTO credit_transactions (user_id, amount, reason, reference_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, amount, reason, referenceId || null]
  );

  return result.rows[0];
}

/**
 * Consume credits from user account
 */
export async function consumeCredits(
  userId: string,
  amount: number,
  reason: string,
  referenceId?: string
): Promise<CreditTransaction> {
  // Internal users bypass credit consumption
  const isInternal = await isInternalUser(userId);
  if (isInternal) {
    // Still record the transaction for audit, but don't actually consume
    return addCredits(userId, 0, reason, referenceId);
  }

  if (amount <= 0) {
    throw new Error('Credit amount must be positive');
  }

  // Check if user has enough credits
  const currentCredits = await getUserCredits(userId);
  if (currentCredits < amount) {
    throw new Error(`Insufficient credits: ${currentCredits} available, ${amount} required`);
  }

  const result = await pool.query<CreditTransaction>(
    `INSERT INTO credit_transactions (user_id, amount, reason, reference_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, -amount, reason, referenceId || null]
  );

  return result.rows[0];
}

/**
 * Assert user has enough credits available
 * Throws error if insufficient credits
 */
export async function assertCreditsAvailable(
  userId: string,
  requiredAmount: number
): Promise<void> {
  // Internal users bypass credit checks
  const isInternal = await isInternalUser(userId);
  if (isInternal) {
    return;
  }

  const currentCredits = await getUserCredits(userId);
  if (currentCredits < requiredAmount) {
    const error: any = new Error(
      `Insufficient credits: ${currentCredits} available, ${requiredAmount} required`
    );
    error.code = 'CREDIT_LIMIT_REACHED';
    error.available = currentCredits;
    error.required = requiredAmount;
    throw error;
  }
}

/**
 * Get credit transaction history for a user
 */
export async function getCreditHistory(
  userId: string,
  limit: number = 100
): Promise<CreditTransaction[]> {
  const result = await pool.query<CreditTransaction>(
    `SELECT *
     FROM credit_transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows;
}
