import { pool } from '../config/database.js';
import type { Industry } from '../types/index.js';

/**
 * Get all industries belonging to an industry group
 * Returns industries sorted by search_weight DESC
 */
export async function getIndustriesByGroup(groupId: string): Promise<Industry[]> {
  // Note: The column in industries table is 'group_id', not 'industry_group_id'
  // search_weight is in industry_groups table, so we need to join to get it for ordering
  // Use COALESCE to handle case where search_weight column doesn't exist yet
  try {
    const result = await pool.query<Industry & { group_id: string | null; search_weight: number | null }>(
      `SELECT 
         i.*,
         ig.search_weight
       FROM industries i
       LEFT JOIN industry_groups ig ON ig.id = i.group_id
       WHERE i.group_id = $1
       ORDER BY COALESCE(ig.search_weight, 0) DESC, i.name ASC`,
      [groupId]
    );
    // Map group_id to industry_group_id for consistency with TypeScript interface
    return result.rows.map(row => ({
      ...row,
      industry_group_id: row.group_id || null,
    }));
  } catch (error: any) {
    // If search_weight column doesn't exist, fall back to ordering by name only
    if (error.code === '42703' && error.message?.includes('search_weight')) {
      console.warn('[getIndustriesByGroup] search_weight column not found, ordering by name only');
      const result = await pool.query<Industry & { group_id: string | null }>(
        `SELECT i.*
         FROM industries i
         WHERE i.group_id = $1
         ORDER BY i.name ASC`,
        [groupId]
      );
      return result.rows.map(row => ({
        ...row,
        industry_group_id: row.group_id || null,
      }));
    }
    throw error;
  }
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
