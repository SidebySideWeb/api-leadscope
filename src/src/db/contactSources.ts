import { pool } from '../config/database.js';
import type { ContactSource } from '../types/index.js';

export async function createContactSource(data: {
  contact_id: number;
  source_url: string;
  page_type: 'homepage' | 'contact' | 'about' | 'company' | 'footer';
  html_hash: string;
}): Promise<ContactSource> {
  const result = await pool.query<ContactSource>(
    `INSERT INTO contact_sources (contact_id, source_url, page_type, html_hash, found_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [data.contact_id, data.source_url, data.page_type, data.html_hash]
  );
  return result.rows[0];
}
