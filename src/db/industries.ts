import { pool } from '../config/database.js';
import type { Industry } from '../types/index.js';

export async function getIndustryByName(name: string): Promise<Industry | null> {
  const result = await pool.query<Industry>(
    'SELECT * FROM industries WHERE name = $1',
    [name]
  );
  return result.rows[0] || null;
}

export async function createIndustry(name: string): Promise<Industry> {
  const result = await pool.query<Industry>(
    'INSERT INTO industries (name) VALUES ($1) RETURNING *',
    [name]
  );
  return result.rows[0];
}

export async function getOrCreateIndustry(name: string): Promise<Industry> {
  const existing = await getIndustryByName(name);
  if (existing) {
    return existing;
  }
  return createIndustry(name);
}
