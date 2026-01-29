import { pool } from '../config/database.js';
import type { ExportRequest, ExportResult, ExportRow } from '../types/exports.js';
import { canExportSnapshot, canExportSubscription } from '../limits/planLimits.js';
import { buildExcelFile } from './excelBuilder.js';
import { buildCsvFile } from './csvBuilder.js';
import { generateWatermark } from './watermark.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

let supabase: ReturnType<typeof createClient> | null = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
} else {
  console.warn('Supabase credentials not configured. File storage will not work.');
}

/**
 * Export snapshot (one-time, frozen export)
 */
export async function exportSnapshot(
  request: ExportRequest
): Promise<ExportResult> {
  const { userId, cityId, format = 'xlsx', filters } = request;

  if (!filters?.datasetId) {
    throw new Error('Dataset ID is required for snapshot exports');
  }

  const datasetId = filters.datasetId;

  // Check plan limits (using filters if provided)
  const planCheck = await canExportSnapshot(userId, filters?.industryId || 0, cityId || 0);
  if (!planCheck.allowed) {
    throw new Error(planCheck.reason || 'Export not allowed');
  }

  // Get dataset to verify ownership
  const { getDatasetById } = await import('../db/datasets.js');
  const dataset = await getDatasetById(datasetId);
  if (!dataset) {
    throw new Error(`Dataset ${datasetId} not found`);
  }
  if (dataset.user_id !== userId) {
    throw new Error('Dataset does not belong to user');
  }

  // Query data with dataset and user filters
  const rows = await queryExportData({
    industryId: undefined, // Will be filtered by dataset
    cityId,
    datasetId: dataset.id,
    ownerUserId: dataset.user_id,
    rowLimit: undefined // No limit for snapshot (but should be reasonable)
  });

  // Generate file
  const exportId = crypto.randomUUID();
  const filename = `snapshot-${datasetId}-${cityId || 'all'}-${exportId}.${format}`;
  const filePath = `exports/${userId}/${filename}`;

  let fileBuffer: Buffer;
  if (format === 'xlsx') {
    fileBuffer = await buildExcelFile(rows, 'snapshot');
  } else {
    const csvContent = buildCsvFile(rows, 'snapshot');
    fileBuffer = Buffer.from(csvContent, 'utf-8');
  }

  // Upload to Supabase Storage
  if (!supabase) {
    throw new Error('Supabase storage not configured');
  }

  const { error: uploadError } = await supabase.storage
    .from('exports')
    .upload(filePath, fileBuffer, {
      contentType: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
      upsert: false
    });

  if (uploadError) {
    throw new Error(`Failed to upload export file: ${uploadError.message}`);
  }

  // Generate signed URL (expires in 7 days)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const { data: urlData, error: urlError } = await supabase.storage
    .from('exports')
    .createSignedUrl(filePath, 60 * 60 * 24 * 7); // 7 days

  if (urlError || !urlData) {
    throw new Error(`Failed to generate download URL: ${urlError?.message}`);
  }

  // Log export
  const watermarkText = generateWatermark('snapshot');
  await logExport({
    exportId,
    userId,
    exportType: 'snapshot',
    industryId: filters?.industryId || null,
    cityId: cityId || null,
    totalRows: rows.length,
    format,
    filePath,
    watermarkText,
    filters: { datasetId, industryId: filters?.industryId, cityId },
    expiresAt
  });

  return {
    exportId,
    filePath,
    downloadUrl: urlData.signedUrl,
    totalRows: rows.length,
    expiresAt
  };
}

/**
 * Export subscription (monthly, limited)
 */
export async function exportSubscription(
  request: ExportRequest
): Promise<ExportResult> {
  const { userId, filters = {}, format = 'xlsx', rowLimit } = request;

  // Check plan limits
  const requestedRows = rowLimit || 1000;
  const planCheck = await canExportSubscription(userId, requestedRows);
  if (!planCheck.allowed) {
    throw new Error(planCheck.reason || 'Export not allowed');
  }

  // Apply row limit
  const actualRowLimit = Math.min(requestedRows, planCheck.remainingRows || requestedRows);

  // Query data
  const rows = await queryExportData({
    ...filters,
    rowLimit: actualRowLimit
  });

  // Generate file
  const exportId = crypto.randomUUID();
  const filename = `subscription-${userId}-${Date.now()}.${format}`;
  const filePath = `exports/${userId}/${filename}`;

  let fileBuffer: Buffer;
  if (format === 'xlsx') {
    fileBuffer = await buildExcelFile(rows, 'subscription');
  } else {
    const csvContent = buildCsvFile(rows, 'subscription');
    fileBuffer = Buffer.from(csvContent, 'utf-8');
  }

  // Upload to Supabase Storage
  if (!supabase) {
    throw new Error('Supabase storage not configured');
  }

  const { error: uploadError } = await supabase.storage
    .from('exports')
    .upload(filePath, fileBuffer, {
      contentType: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
      upsert: false
    });

  if (uploadError) {
    throw new Error(`Failed to upload export file: ${uploadError.message}`);
  }

  // Generate signed URL (expires in 30 days)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const { data: urlData, error: urlError } = await supabase.storage
    .from('exports')
    .createSignedUrl(filePath, 60 * 60 * 24 * 30); // 30 days

  if (urlError || !urlData) {
    throw new Error(`Failed to generate download URL: ${urlError?.message}`);
  }

  // Log export
  const watermarkText = generateWatermark('subscription');
  await logExport({
    exportId,
    userId,
    exportType: 'subscription',
    industryId: filters.industryId,
    cityId: filters.cityId,
    totalRows: rows.length,
    format,
    filePath,
    watermarkText,
    filters,
    expiresAt
  });

  return {
    exportId,
    filePath,
    downloadUrl: urlData.signedUrl,
    totalRows: rows.length,
    expiresAt
  };
}

/**
 * Query export data with filters
 */
async function queryExportData(filters: {
  industryId?: number;
  cityId?: number;
  datasetId?: string; // UUID
  ownerUserId?: string;
  isActiveContactsOnly?: boolean;
  minLastVerifiedDays?: number;
  hasWebsite?: boolean;
  hasEmail?: boolean;
  hasPhone?: boolean;
  rowLimit?: number;
}): Promise<ExportRow[]> {
  let query = `
    SELECT DISTINCT
      b.name as company_name,
      i.name as industry,
      c.name as city,
      b.address,
      w.url as website,
      ct.email,
      ct.phone,
      ct.mobile,
      cs.source_url,
      ct.first_seen_at,
      ct.last_verified_at,
      CASE WHEN ct.is_active THEN 'active' ELSE 'removed' END as contact_status
    FROM businesses b
    JOIN industries i ON b.industry_id = i.id
    JOIN cities c ON b.city_id = c.id
    LEFT JOIN websites w ON w.business_id = b.id
    JOIN contact_sources cs ON cs.source_url LIKE '%' || REPLACE(REPLACE(w.url, 'https://', ''), 'http://', '') || '%'
       OR cs.source_url = w.url
    JOIN contacts ct ON ct.id = cs.contact_id
    WHERE ct.id IS NOT NULL
  `;

  const params: any[] = [];
  let paramCount = 1;

  if (filters.industryId) {
    query += ` AND b.industry_id = $${paramCount++}`;
    params.push(filters.industryId);
  }

  if (filters.cityId) {
    query += ` AND b.city_id = $${paramCount++}`;
    params.push(filters.cityId);
  }

  if (filters.datasetId) {
    query += ` AND b.dataset_id = $${paramCount++}`;
    params.push(filters.datasetId);
  }

  if (filters.ownerUserId) {
    query += ` AND b.owner_user_id = $${paramCount++}`;
    params.push(filters.ownerUserId);
  }

  if (filters.isActiveContactsOnly) {
    query += ` AND ct.is_active = TRUE`;
  }

  if (filters.minLastVerifiedDays) {
    query += ` AND ct.last_verified_at >= NOW() - INTERVAL '${filters.minLastVerifiedDays} days'`;
  }

  if (filters.hasWebsite) {
    query += ` AND w.url IS NOT NULL`;
  }

  if (filters.hasEmail) {
    query += ` AND ct.email IS NOT NULL`;
  }

  if (filters.hasPhone) {
    query += ` AND (ct.phone IS NOT NULL OR ct.mobile IS NOT NULL)`;
  }

  query += ` ORDER BY b.name, ct.last_verified_at DESC`;

  if (filters.rowLimit) {
    query += ` LIMIT $${paramCount++}`;
    params.push(filters.rowLimit);
  }

  const result = await pool.query<ExportRow>(query, params);
  return result.rows;
}

/**
 * Log export to database
 */
async function logExport(data: {
  exportId: string;
  userId: string;
  exportType: 'snapshot' | 'subscription' | 'admin';
  industryId?: number | null;
  cityId?: number | null;
  totalRows: number;
  format: 'csv' | 'xlsx';
  filePath: string;
  watermarkText: string;
  filters?: any;
  expiresAt?: Date;
}): Promise<void> {
  await pool.query(
    `INSERT INTO exports (
      id, user_id, export_type, industry_id, city_id, total_rows,
      file_format, file_path, watermark_text, filters, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      data.exportId,
      data.userId,
      data.exportType,
      data.industryId || null,
      data.cityId || null,
      data.totalRows,
      data.format,
      data.filePath,
      data.watermarkText,
      data.filters ? JSON.stringify(data.filters) : null,
      data.expiresAt || null
    ]
  );
}
