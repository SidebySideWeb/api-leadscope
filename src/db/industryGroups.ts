import { pool } from '../config/database.js';
import type { Industry } from '../types/index.js';

/**
 * Get all industries belonging to an industry group
 * Returns industries sorted by search_weight DESC
 */
export async function getIndustriesByGroup(groupId: string): Promise<Industry[]> {
  // Note: The column in industries table is 'group_id', not 'industry_group_id'
  const result = await pool.query<Industry & { group_id: string | null }>(
    `SELECT *
     FROM industries
     WHERE group_id = $1
     ORDER BY search_weight DESC NULLS LAST, name ASC`,
    [groupId]
  );
  // Map group_id to industry_group_id for consistency with TypeScript interface
  return result.rows.map(row => ({
    ...row,
    industry_group_id: row.group_id || null,
  }));
}

/**
 * Get industry group by ID
 */
export async function getIndustryGroupById(id: string): Promise<{ id: string; name: string; created_at: Date } | null> {
  const result = await pool.query<{ id: string; name: string; created_at: Date }>(
    'SELECT * FROM industry_groups WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Get all industry groups
 */
export async function getIndustryGroups(): Promise<Array<{ id: string; name: string; created_at: Date }>> {
  const result = await pool.query<{ id: string; name: string; created_at: Date }>(
    'SELECT * FROM industry_groups ORDER BY name ASC'
  );
  return result.rows;
}
