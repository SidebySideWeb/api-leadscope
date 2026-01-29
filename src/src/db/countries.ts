import { pool } from '../config/database.js';
import type { Country } from '../types/index.js';

export async function getCountryByCode(code: string): Promise<Country | null> {
  const result = await pool.query<Country>(
    'SELECT * FROM countries WHERE iso_code = $1',
    [code]
  );
  return result.rows[0] || null;
}

export async function getCountryById(id: number): Promise<Country | null> {
  const result = await pool.query<Country>(
    'SELECT * FROM countries WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}
