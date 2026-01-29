/**
 * Crawl Results V1 Database Module
 * 
 * Handles upserting crawl results to the crawl_results table.
 * Uses ON CONFLICT to update existing rows or insert new ones.
 */

import { pool } from '../config/database.js';
import type { CrawlStatus } from '../types/crawl.js';

/**
 * Convert an integer business ID to a deterministic UUID string.
 * Uses a simple padding approach to create a valid UUID format.
 * 
 * Note: This is a temporary solution. Ideally, businesses.id should be UUID.
 * For now, we convert integer IDs to UUID-like strings for compatibility.
 */
export function integerToUuid(integerId: number | string): string {
  if (typeof integerId === 'string') {
    // If it's already a string, check if it's a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(integerId)) {
      return integerId;
    }
    // If it's a numeric string, convert to number first
    const numId = parseInt(integerId, 10);
    if (!isNaN(numId)) {
      integerId = numId;
    } else {
      // If it's not numeric and not UUID, generate a deterministic UUID
      // Using a simple hash-like approach
      return integerId;
    }
  }
  
  // Convert integer to hex and pad to 32 characters (UUID format)
  const hex = integerId.toString(16).padStart(32, '0');
  // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

export interface UpsertCrawlResultV1Input {
  businessId: string; // UUID (stringified business.id)
  datasetId: string; // UUID
  websiteUrl: string;
  startedAt: Date;
  finishedAt: Date;
  pagesVisited: number;
  crawlStatus: CrawlStatus;
  emails: Array<{
    value: string;
    source_url: string;
    context?: string;
  }>;
  phones: Array<{
    value: string;
    source_url: string;
  }>;
  contactPages: string[];
  social: {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
    twitter?: string;
    youtube?: string;
  };
  errors: Array<{
    url?: string;
    message: string;
    code?: string;
  }>;
}

/**
 * Upsert crawl result v1 to database
 * 
 * Uses ON CONFLICT (business_id, dataset_id) DO UPDATE to handle duplicates.
 * Preserves created_at on update (does not overwrite).
 * 
 * @param input - Crawl result data
 * @returns The inserted/updated crawl result row
 */
export async function upsertCrawlResultV1(
  input: UpsertCrawlResultV1Input
): Promise<void> {
  const {
    businessId,
    datasetId,
    websiteUrl,
    startedAt,
    finishedAt,
    pagesVisited,
    crawlStatus,
    emails,
    phones,
    contactPages,
    social,
    errors,
  } = input;

  // Convert businessId to UUID format
  // Handle both integer IDs (from businesses table) and UUID strings
  const businessIdUuid = typeof businessId === 'number'
    ? integerToUuid(businessId)
    : integerToUuid(businessId);

  // Prepare JSONB data
  const emailsJsonb = JSON.stringify(emails);
  const phonesJsonb = JSON.stringify(phones);
  const socialJsonb = JSON.stringify(social);
  const errorsJsonb = JSON.stringify(errors);

  // Insert or update using ON CONFLICT
  // Preserve created_at on update (don't overwrite it)
  await pool.query(
    `
    INSERT INTO crawl_results (
      business_id,
      dataset_id,
      website_url,
      started_at,
      finished_at,
      pages_visited,
      crawl_status,
      emails,
      phones,
      contact_pages,
      social,
      errors,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::jsonb, $12::jsonb, NOW())
    ON CONFLICT (business_id, dataset_id)
    DO UPDATE SET
      website_url = EXCLUDED.website_url,
      started_at = EXCLUDED.started_at,
      finished_at = EXCLUDED.finished_at,
      pages_visited = EXCLUDED.pages_visited,
      crawl_status = EXCLUDED.crawl_status,
      emails = EXCLUDED.emails,
      phones = EXCLUDED.phones,
      contact_pages = EXCLUDED.contact_pages,
      social = EXCLUDED.social,
      errors = EXCLUDED.errors,
      updated_at = NOW()
    -- Note: created_at is NOT updated, preserving original creation time
    -- Note: updated_at is set to NOW() on every update
    `,
    [
      businessIdUuid,
      datasetId,
      websiteUrl,
      startedAt,
      finishedAt,
      pagesVisited,
      crawlStatus,
      emailsJsonb,
      phonesJsonb,
      contactPages,
      socialJsonb,
      errorsJsonb,
    ]
  );
}
