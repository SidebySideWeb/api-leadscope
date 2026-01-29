/**
 * Export Service V2 - Using store abstraction with plan-based gating
 */

import { resolveStore } from '../stores/resolver.js';
import { datasetResolver } from '../stores/resolver.js';
import { getUserPlan, enforceExportLimit } from '../limits/exportLimits.js';
import type { ExportRequest, ExportResult, ExportRow } from '../types/exports.js';
import { buildExcelFile } from './excelBuilder.js';
import { buildCsvFile } from './csvBuilder.js';
import { generateWatermark } from './watermark.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

let supabase: ReturnType<typeof createClient> | null = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
} else {
  console.warn('[exportService] Supabase credentials not configured. File storage will use local filesystem.');
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

  // Get user plan and enforce limits
  const plan = await getUserPlan(userId);
  const limitCheck = enforceExportLimit(plan);
  
  if (!limitCheck.allowed) {
    throw new Error(limitCheck.reason || 'Export not allowed');
  }

  // Resolve dataset and snapshot
  const { dataset, snapshot, shouldQueueDiscovery } = await datasetResolver(userId, datasetId);
  
  if (shouldQueueDiscovery) {
    console.log('[exportService] Discovery queued in background');
  }

  // Get export rows from store
  const store = await resolveStore();
  let rows: ExportRow[];

  if (snapshot) {
    // Use snapshot data
    console.log('[exportService] Using snapshot data for export');
    rows = await store.getExportRows({
      datasetId,
      userId,
      rowLimit: limitCheck.maxRows
    });
  } else if (dataset) {
    // Query from database
    rows = await store.getExportRows({
      datasetId: dataset.id,
      userId,
      rowLimit: limitCheck.maxRows
    });
  } else {
    throw new Error(`Dataset ${datasetId} not found or not accessible`);
  }

  // Enforce row limit
  if (rows.length > limitCheck.maxRows) {
    rows = rows.slice(0, limitCheck.maxRows);
    console.log(`[exportService] Limited export to ${limitCheck.maxRows} rows (${plan} plan)`);
  }

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

  // Save file (Supabase Storage or local filesystem)
  let downloadUrl: string;
  let finalFilePath: string;

  if (supabase) {
    // Upload to Supabase Storage
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

    downloadUrl = urlData.signedUrl;
    finalFilePath = filePath;
  } else {
    // Fallback to local filesystem
    console.warn('[exportService] Using local filesystem storage (Supabase unavailable)');
    const localExportsDir = path.join(process.cwd(), '.local-exports', userId);
    await fs.mkdir(localExportsDir, { recursive: true });
    
    const localFilePath = path.join(localExportsDir, filename);
    await fs.writeFile(localFilePath, fileBuffer);
    
    finalFilePath = localFilePath;
    downloadUrl = `file://${localFilePath}`;
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
    filePath: finalFilePath,
    watermarkText,
    filters: { datasetId, industryId: filters?.industryId, cityId },
    plan
  });

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  return {
    exportId,
    filePath: finalFilePath,
    downloadUrl,
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

  // Get user plan and enforce limits
  const plan = await getUserPlan(userId);
  const requestedRows = rowLimit || 1000;
  const limitCheck = enforceExportLimit(plan, requestedRows);
  
  if (!limitCheck.allowed) {
    throw new Error(limitCheck.reason || 'Export not allowed');
  }

  const datasetId = filters.datasetId;
  if (!datasetId) {
    throw new Error('Dataset ID is required for subscription exports');
  }

  // Resolve dataset and snapshot
  const { dataset, snapshot } = await datasetResolver(userId, datasetId);

  // Get export rows from store
  const store = await resolveStore();
  let rows: ExportRow[];

  if (snapshot) {
    rows = await store.getExportRows({
      datasetId,
      userId,
      rowLimit: limitCheck.maxRows
    });
  } else if (dataset) {
    rows = await store.getExportRows({
      datasetId: dataset.id,
      userId,
      rowLimit: limitCheck.maxRows
    });
  } else {
    throw new Error(`Dataset ${datasetId} not found or not accessible`);
  }

  // Enforce row limit
  if (rows.length > limitCheck.maxRows) {
    rows = rows.slice(0, limitCheck.maxRows);
    console.log(`[exportService] Limited export to ${limitCheck.maxRows} rows (${plan} plan)`);
  }

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

  // Save file (Supabase Storage or local filesystem)
  let downloadUrl: string;
  let finalFilePath: string;

  if (supabase) {
    // Upload to Supabase Storage
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
    const { data: urlData, error: urlError } = await supabase.storage
      .from('exports')
      .createSignedUrl(filePath, 60 * 60 * 24 * 30); // 30 days

    if (urlError || !urlData) {
      throw new Error(`Failed to generate download URL: ${urlError?.message}`);
    }

    downloadUrl = urlData.signedUrl;
    finalFilePath = filePath;
  } else {
    // Fallback to local filesystem
    console.warn('[exportService] Using local filesystem storage (Supabase unavailable)');
    const localExportsDir = path.join(process.cwd(), '.local-exports', userId);
    await fs.mkdir(localExportsDir, { recursive: true });
    
    const localFilePath = path.join(localExportsDir, filename);
    await fs.writeFile(localFilePath, fileBuffer);
    
    finalFilePath = localFilePath;
    downloadUrl = `file://${localFilePath}`;
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
    filePath: finalFilePath,
    watermarkText,
    filters,
    plan
  });

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  return {
    exportId,
    filePath: finalFilePath,
    downloadUrl,
    totalRows: rows.length,
    expiresAt
  };
}

/**
 * Log export to database or local store
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
  plan: string;
}): Promise<void> {
  const store = await resolveStore();
  
  // Try to log to database if using SupabaseStore
  if (store.constructor.name === 'SupabaseStore') {
    try {
      const { pool } = await import('../config/database.js');
      await pool.query(
        `INSERT INTO exports (
          id, user_id, export_type, industry_id, city_id, total_rows,
          file_format, file_path, watermark_text, filters
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
          data.filters ? JSON.stringify(data.filters) : null
        ]
      );
      return;
    } catch (error) {
      console.warn('[exportService] Failed to log export to database, using local log:', error);
    }
  }

  // Fallback to local log file
  const logDir = path.join(process.cwd(), '.local-exports', 'logs');
  await fs.mkdir(logDir, { recursive: true });
  const logFile = path.join(logDir, `export-${data.exportId}.json`);
  await fs.writeFile(logFile, JSON.stringify({
    ...data,
    logged_at: new Date().toISOString()
  }, null, 2), 'utf-8');
}
