/**
 * Export Schema v1
 * 
 * Requirements:
 * - CSV output
 * - Columns: business_name, website, email, phone, source_page, confidence
 * - Enforce demo export limit (50 rows)
 * - Save file under dataset folder
 */

import { assertExport, getExportLimit, type Plan } from '../pricing.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Export Row v1 - Exact schema as specified
 */
export interface ExportRowV1 {
  business_name: string;
  website: string;
  email: string;
  phone: string;
  source_page: string;
  confidence: string; // Number as string (0-1)
}

/**
 * Input data structure for building export rows
 */
export interface BusinessExportInput {
  business: {
    name: string;
  };
  website: {
    url: string;
  } | null;
  contact: {
    email: string | null;
    phone: string | null;
    source_url: string;
    confidence?: number;
  } | null;
}

/**
 * Build export rows from business data
 * Enforces demo export limit (50 rows) using pricing gates
 * 
 * @param businesses - Array of business data
 * @param plan - User's plan (demo | paid)
 * @returns Array of export rows (limited by plan)
 */
export function buildExportRowsV1(
  businesses: BusinessExportInput[],
  plan: Plan
): ExportRowV1[] {
  // Enforce export limit using pricing gates (throws if exceeded)
  try {
    assertExport(plan, businesses.length);
  } catch (error: any) {
    // If limit exceeded, truncate to allowed limit
    const limit = getExportLimit(plan);
    console.warn(`[buildExportRowsV1] Export limit exceeded. Truncating to ${limit} rows.`);
    businesses = businesses.slice(0, limit);
  }

  // Get actual limit (for logging)
  const limit = getExportLimit(plan);
  const rowsToProcess = businesses.slice(0, limit);
  const isTruncated = businesses.length > limit;

  console.log(
    `[buildExportRowsV1] Processing ${rowsToProcess.length} businesses ` +
    `(plan: ${plan}, limit: ${limit}, truncated: ${isTruncated})`
  );

  // Build export rows
  const rows: ExportRowV1[] = rowsToProcess.map((data) => {
    const business = data.business;
    const website = data.website;
    const contact = data.contact;

    return {
      business_name: business.name || '',
      website: website?.url || '',
      email: contact?.email || '',
      phone: contact?.phone || '',
      source_page: contact?.source_url || '',
      confidence: contact?.confidence !== undefined 
        ? String(contact.confidence) 
        : '',
    };
  });

  return rows;
}

/**
 * Export rows to CSV format (RFC4180 compatible)
 * 
 * @param rows - Array of export rows
 * @returns CSV content as string
 */
export function exportToCSVV1(rows: ExportRowV1[]): string {
  if (rows.length === 0) {
    return '';
  }

  // Fixed header order (exact schema order)
  const headers: Array<keyof ExportRowV1> = [
    'business_name',
    'website',
    'email',
    'phone',
    'source_page',
    'confidence',
  ];

  // Escape CSV value (RFC4180)
  const escapeCSV = (value: string | number | boolean): string => {
    const str = String(value);
    
    // If contains comma, newline, or double quote, wrap in quotes and escape quotes
    if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    
    return str;
  };

  // Build CSV content
  const lines: string[] = [];

  // Header row
  lines.push(headers.map(h => escapeCSV(h)).join(','));

  // Data rows
  for (const row of rows) {
    const values = headers.map(header => {
      const value = row[header];
      return escapeCSV(value);
    });
    lines.push(values.join(','));
  }

  const csv = lines.join('\n');
  console.log(`[exportToCSVV1] Generated CSV with ${rows.length} rows, ${csv.length} bytes`);
  
  return csv;
}

/**
 * Get dataset directory path
 */
function getDatasetDir(datasetId: string): string {
  const DATA_DIR = path.join(process.cwd(), 'data', 'datasets');
  return path.join(DATA_DIR, datasetId);
}

/**
 * Save export file to dataset folder
 * 
 * @param datasetId - Dataset UUID
 * @param csvContent - CSV content as string
 * @returns File path
 */
export async function saveExportFileV1(
  datasetId: string,
  csvContent: string
): Promise<string> {
  // Get dataset directory
  const datasetDir = getDatasetDir(datasetId);
  
  // Ensure directory exists
  await fs.mkdir(datasetDir, { recursive: true });
  
  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `export-${timestamp}.csv`;
  const filePath = path.join(datasetDir, filename);
  
  // Write CSV file
  await fs.writeFile(filePath, csvContent, 'utf-8');
  
  console.log(`[saveExportFileV1] Saved export file to ${filePath}`);
  
  return filePath;
}

/**
 * Export dataset to CSV (complete workflow)
 * 
 * @param businesses - Array of business data
 * @param plan - User's plan (demo | paid)
 * @param datasetId - Dataset UUID
 * @returns Export result with file path and row counts
 */
export async function exportDatasetV1(
  businesses: BusinessExportInput[],
  plan: Plan,
  datasetId: string
): Promise<{
  success: boolean;
  filePath: string;
  rows_exported: number;
  rows_total: number;
  limit: number;
  error?: string;
}> {
  try {
    // Build export rows (enforces limit)
    const rows = buildExportRowsV1(businesses, plan);
    
    // Generate CSV
    const csvContent = exportToCSVV1(rows);
    
    // Save to dataset folder
    const filePath = await saveExportFileV1(datasetId, csvContent);
    
    // Get limit for response
    const limit = getExportLimit(plan);
    
    return {
      success: true,
      filePath,
      rows_exported: rows.length,
      rows_total: businesses.length,
      limit,
    };
  } catch (error: any) {
    console.error(`[exportDatasetV1] Error:`, error);
    return {
      success: false,
      filePath: '',
      rows_exported: 0,
      rows_total: businesses.length,
      limit: getExportLimit(plan),
      error: error.message || 'Export failed',
    };
  }
}
