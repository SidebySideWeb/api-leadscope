import { pool } from '../config/database.js';
import type { Contact } from '../types/index.js';

export async function getContactByEmail(email: string): Promise<Contact | null> {
  const result = await pool.query<Contact>(
    'SELECT * FROM contacts WHERE email = $1',
    [email]
  );
  return result.rows[0] || null;
}

export async function getContactByPhone(phone: string): Promise<Contact | null> {
  const result = await pool.query<Contact>(
    'SELECT * FROM contacts WHERE phone = $1 OR mobile = $1',
    [phone]
  );
  return result.rows[0] || null;
}

export async function createContact(data: {
  email: string | null;
  phone: string | null;
  mobile: string | null;
  contact_type: 'email' | 'phone' | 'mobile';
  is_generic: boolean;
}): Promise<Contact> {
  try {
    console.log(`[createContact] Attempting to create contact:`, {
      email: data.email ? `${data.email.substring(0, 10)}...` : null,
      phone: data.phone ? `${data.phone.substring(0, 5)}...` : null,
      mobile: data.mobile ? `${data.mobile.substring(0, 5)}...` : null,
      contact_type: data.contact_type,
      is_generic: data.is_generic
    });

    const result = await pool.query<Contact>(
      `INSERT INTO contacts (email, phone, mobile, contact_type, is_generic, first_seen_at, last_verified_at, is_active)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), TRUE)
       RETURNING *`,
      [data.email, data.phone, data.mobile, data.contact_type, data.is_generic]
    );

    if (result.rows.length === 0) {
      throw new Error('INSERT returned no rows');
    }

    console.log(`[createContact] Successfully created contact with id: ${result.rows[0].id}`);
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
      parameters: [data.email ? '***' : null, data.phone ? '***' : null, data.mobile ? '***' : null, data.contact_type, data.is_generic]
    };

    if (error.code === '42501') {
      console.error(`[createContact] RLS POLICY VIOLATION - Permission denied:`, errorDetails);
      console.error(`[createContact] This indicates a Row Level Security policy is blocking the INSERT`);
      console.error(`[createContact] Check RLS policies on 'contacts' table for INSERT operations`);
    } else if (error.code === '23505') {
      console.error(`[createContact] UNIQUE CONSTRAINT VIOLATION:`, errorDetails);
    } else if (error.code === '42P01') {
      console.error(`[createContact] TABLE DOES NOT EXIST:`, errorDetails);
    } else if (error.code === '08006' || error.code === '57P01' || error.code === '57P02' || error.code === '57P03') {
      console.error(`[createContact] DATABASE CONNECTION ERROR:`, errorDetails);
    } else {
      console.error(`[createContact] DATABASE ERROR:`, errorDetails);
    }

    throw error;
  }
}

export async function getOrCreateContact(data: {
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  contact_type: 'email' | 'phone' | 'mobile';
  is_generic: boolean;
}): Promise<Contact> {
  // Check for existing contact
  if (data.email) {
    const existing = await getContactByEmail(data.email);
    if (existing) return existing;
  }
  if (data.phone || data.mobile) {
    const phone = data.phone || data.mobile;
    if (phone) {
      const existing = await getContactByPhone(phone);
      if (existing) return existing;
    }
  }

  return createContact({
    email: data.email || null,
    phone: data.phone || null,
    mobile: data.mobile || null,
    contact_type: data.contact_type,
    is_generic: data.is_generic
  });
}
