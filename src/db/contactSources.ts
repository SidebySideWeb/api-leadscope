import { pool } from '../config/database.js';
import type { ContactSource } from '../types/index.js';

export async function createContactSource(data: {
  contact_id: number;
  source_url: string;
  page_type: 'homepage' | 'contact' | 'about' | 'company' | 'footer';
  html_hash: string;
  business_id?: number | null;
}): Promise<ContactSource> {
  try {
    console.log(`[createContactSource] Attempting to create contact_source:`, {
      contact_id: data.contact_id,
      business_id: data.business_id || null,
      source_url: data.source_url.substring(0, 50) + '...',
      page_type: data.page_type,
      html_hash: data.html_hash.substring(0, 10) + '...'
    });

    // Always try to insert with business_id - migration should add this column
    // If column doesn't exist yet, the migration needs to be run first
    const result = await pool.query<ContactSource>(
      `INSERT INTO contact_sources (contact_id, business_id, source_url, page_type, html_hash, found_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [data.contact_id, data.business_id || null, data.source_url, data.page_type, data.html_hash]
    );

    if (result.rows.length === 0) {
      throw new Error('INSERT returned no rows');
    }

    console.log(`[createContactSource] Successfully created contact_source with id: ${result.rows[0].id}`);
    return result.rows[0];
  } catch (error: any) {
    const errorDetails = {
      code: error.code,
      message: error.message,
      detail: error.detail,
      hint: error.hint,
      constraint: error.constraint,
      table: error.table,
      schema: error.schema,
      severity: error.severity,
      sqlState: error.sqlState,
      query: error.query,
      parameters: [data.contact_id, data.source_url.substring(0, 50), data.page_type, data.html_hash.substring(0, 10)]
    };

    if (error.code === '42501') {
      console.error(`[createContactSource] RLS POLICY VIOLATION - Permission denied:`, errorDetails);
      console.error(`[createContactSource] This indicates a Row Level Security policy is blocking the INSERT`);
      console.error(`[createContactSource] Check RLS policies on 'contact_sources' table for INSERT operations`);
      console.error(`[createContactSource] Verify that contact_id ${data.contact_id} exists and is accessible`);
    } else if (error.code === '23503') {
      console.error(`[createContactSource] FOREIGN KEY VIOLATION:`, errorDetails);
      console.error(`[createContactSource] Contact with id ${data.contact_id} may not exist`);
    } else if (error.code === '23505') {
      console.error(`[createContactSource] UNIQUE CONSTRAINT VIOLATION:`, errorDetails);
    } else if (error.code === '42P01') {
      console.error(`[createContactSource] TABLE DOES NOT EXIST:`, errorDetails);
    } else if (error.code === '08006' || error.code === '57P01' || error.code === '57P02' || error.code === '57P03') {
      console.error(`[createContactSource] DATABASE CONNECTION ERROR:`, errorDetails);
    } else {
      console.error(`[createContactSource] DATABASE ERROR:`, errorDetails);
    }

    throw error;
  }
}
