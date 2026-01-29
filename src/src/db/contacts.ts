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
  const result = await pool.query<Contact>(
    `INSERT INTO contacts (email, phone, mobile, contact_type, is_generic, first_seen_at, last_verified_at, is_active)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), TRUE)
     RETURNING *`,
    [data.email, data.phone, data.mobile, data.contact_type, data.is_generic]
  );
  return result.rows[0];
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
