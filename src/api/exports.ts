import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import { runDatasetExport } from '../workers/exportWorker.js';
import { verifyDatasetOwnership } from '../db/datasets.js';
import { enforceExport } from '../services/enforcementService.js';
import { consumeCredits } from '../services/creditService.js';
import { calculateExportCost } from '../config/creditCostConfig.js';
import { incrementExports } from '../db/usageTracking.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Check if all crawl and extraction jobs for a dataset are complete
 * Returns: { allComplete: boolean, pendingCrawlJobs: number, pendingExtractionJobs: number }
 */
async function checkDatasetJobsComplete(datasetId: string): Promise<{
  allComplete: boolean;
  pendingCrawlJobs: number;
  pendingExtractionJobs: number;
  runningCrawlJobs: number;
  runningExtractionJobs: number;
}> {
  // Check crawl jobs (pending or running)
  const crawlJobsResult = await pool.query<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM crawl_jobs cj
     JOIN websites w ON w.id = cj.website_id
     JOIN businesses b ON b.id = w.business_id
     WHERE b.dataset_id = $1
       AND cj.status IN ('pending', 'running')`,
    [datasetId]
  );
  const pendingCrawlJobs = parseInt(crawlJobsResult.rows[0]?.count.toString() || '0');

  const runningCrawlJobsResult = await pool.query<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM crawl_jobs cj
     JOIN websites w ON w.id = cj.website_id
     JOIN businesses b ON b.id = w.business_id
     WHERE b.dataset_id = $1
       AND cj.status = 'running'`,
    [datasetId]
  );
  const runningCrawlJobs = parseInt(runningCrawlJobsResult.rows[0]?.count.toString() || '0');

  // Check extraction jobs (pending or running)
  const extractionJobsResult = await pool.query<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM extraction_jobs ej
     JOIN businesses b ON b.id = ej.business_id
     WHERE b.dataset_id = $1
       AND ej.status IN ('pending', 'running')`,
    [datasetId]
  );
  const pendingExtractionJobs = parseInt(extractionJobsResult.rows[0]?.count.toString() || '0');

  const runningExtractionJobsResult = await pool.query<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM extraction_jobs ej
     JOIN businesses b ON b.id = ej.business_id
     WHERE b.dataset_id = $1
       AND ej.status = 'running'`,
    [datasetId]
  );
  const runningExtractionJobs = parseInt(runningExtractionJobsResult.rows[0]?.count.toString() || '0');

  const allComplete = pendingCrawlJobs === 0 && pendingExtractionJobs === 0;

  return {
    allComplete,
    pendingCrawlJobs,
    pendingExtractionJobs,
    runningCrawlJobs,
    runningExtractionJobs
  };
}

/**
 * Wait for all crawl and extraction jobs to complete for a dataset
 * Polls every 2 seconds, with a maximum timeout
 * Returns true if all jobs completed, false if timeout
 */
async function waitForDatasetJobsComplete(
  datasetId: string,
  maxWaitSeconds: number = 300 // 5 minutes default
): Promise<{ completed: boolean; waitedSeconds: number; finalStatus: { pendingCrawlJobs: number; pendingExtractionJobs: number; runningCrawlJobs: number; runningExtractionJobs: number } }> {
  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;
  const pollIntervalMs = 2000; // Check every 2 seconds

  while (true) {
    const status = await checkDatasetJobsComplete(datasetId);
    
    if (status.allComplete) {
      const waitedSeconds = Math.floor((Date.now() - startTime) / 1000);
      console.log(`[waitForDatasetJobsComplete] All jobs completed after ${waitedSeconds} seconds`);
      return { completed: true, waitedSeconds, finalStatus: status };
    }

    const elapsedMs = Date.now() - startTime;
    if (elapsedMs >= maxWaitMs) {
      const waitedSeconds = Math.floor(elapsedMs / 1000);
      console.warn(`[waitForDatasetJobsComplete] Timeout after ${waitedSeconds} seconds. Status:`, status);
      return { completed: false, waitedSeconds, finalStatus: status };
    }

    // Log progress every 10 seconds
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    if (elapsedSeconds % 10 === 0) {
      console.log(`[waitForDatasetJobsComplete] Still waiting... (${elapsedSeconds}s elapsed)`, {
        pendingCrawl: status.pendingCrawlJobs,
        runningCrawl: status.runningCrawlJobs,
        pendingExtraction: status.pendingExtractionJobs,
        runningExtraction: status.runningExtractionJobs
      });
    }

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
}

const router = express.Router();

/**
 * GET /exports
 * Get all exports for the authenticated user
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const datasetId = req.query.dataset as string | undefined;
    
    console.log('[exports] Fetching exports for user:', userId, 'datasetId:', datasetId);
    
    // Get user's plan from database
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;
    console.log('[exports] User plan:', userPlan);

    // The exports table structure uses filters JSONB to store dataset_id
    // We need to query exports by user_id and parse the filters
    let query = `
      SELECT 
        e.id,
        e.user_id,
        e.export_type,
        e.total_rows,
        e.file_format,
        e.file_path,
        e.watermark_text,
        e.filters,
        e.created_at,
        e.expires_at
      FROM exports e
      WHERE e.user_id = $1
    `;
    const params: any[] = [userId];

    if (datasetId) {
      // Filter by dataset_id in filters JSONB
      query += ' AND e.filters->>\'datasetId\' = $2';
      params.push(datasetId);
    }

    query += ' ORDER BY e.created_at DESC';

    console.log('[exports] Executing query with params:', params);
    const result = await pool.query<{
      id: string;
      user_id: string;
      export_type: string;
      total_rows: number;
      file_format: 'csv' | 'xlsx';
      file_path: string;
      watermark_text: string;
      filters: any;
      created_at: Date;
      expires_at: Date | null;
    }>(query, params);

    // Get base URL from request or environment
    // Check X-Forwarded-Proto header (set by nginx/proxy) for HTTPS detection
    const forwardedProto = req.get('X-Forwarded-Proto');
    const protocol = forwardedProto || req.protocol || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
    
    // Use API_BASE_URL if set (should be HTTPS in production), otherwise construct from request
    let baseUrl: string;
    if (process.env.API_BASE_URL) {
      baseUrl = process.env.API_BASE_URL;
    } else {
      const host = req.get('host') || 'localhost:3001';
      baseUrl = `${protocol}://${host}`;
    }
    
    // Ensure HTTPS in production
    if (process.env.NODE_ENV === 'production' && baseUrl.startsWith('http://')) {
      baseUrl = baseUrl.replace('http://', 'https://');
    }
    
    const exports = result.rows.map(row => {
      const filters = row.filters || {};
      const tier = filters.tier || 'starter';
      
      // Determine status: if file_path is empty/null, export is still processing
      const isProcessing = !row.file_path || row.file_path.trim() === '';
      const status = isProcessing ? 'processing' : 'completed';
      
      return {
        id: row.id,
        dataset_id: filters.datasetId || '',
        format: row.file_format,
        tier: tier as 'starter' | 'pro' | 'agency',
        total_rows: row.total_rows,
        rows_returned: row.total_rows, // Same as total_rows for now
        rows_total: row.total_rows,
        file_path: row.file_path,
        download_url: row.file_path && row.file_path.trim() !== '' ? `${baseUrl}/exports/${row.id}/download` : null,
        status: status, // 'processing' or 'completed'
        created_at: row.created_at.toISOString(),
        expires_at: row.expires_at ? row.expires_at.toISOString() : null,
      };
    });

    console.log('[exports] Found', exports.length, 'exports for user', userId);

    res.json({
      data: exports,
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: exports.length,
        total_returned: exports.length,
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching exports:', error);
    res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch exports',
      },
    });
  }
});

/**
 * POST /exports/run
 * Create an export job (async) - returns immediately with export ID
 * Export is processed in background, frontend polls for completion
 */
router.post('/run', authMiddleware, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const { datasetId, format } = req.body;

    console.log('[exports/run] Request:', { userId, datasetId, format });

    // Validate input
    if (!datasetId) {
      res.status(400).json({ error: 'datasetId is required' });
      return;
    }

    if (!format || !['csv', 'xlsx'].includes(format)) {
      res.status(400).json({ error: 'format must be "csv" or "xlsx"' });
      return;
    }

    // Verify dataset ownership
    const ownsDataset = await verifyDatasetOwnership(datasetId, userId);
    if (!ownsDataset) {
      res.status(403).json({ error: 'Dataset not found or access denied' });
      return;
    }

    // Estimate row count for enforcement
    const countResult = await pool.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM businesses WHERE dataset_id = $1',
      [datasetId]
    );
    const estimatedRows = parseInt(countResult.rows[0]?.count.toString() || '0');

    // Enforce export limits and credits
    try {
      await enforceExport(userId, estimatedRows);
    } catch (error: any) {
      if (error.code === 'EXPORT_LIMIT_REACHED' || error.code === 'CREDIT_LIMIT_REACHED') {
        res.status(403).json({
          error: error.message,
          code: error.code,
          current: error.current,
          limit: error.limit,
        });
        return;
      }
      throw error;
    }

    // Get user's plan to determine tier
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;
    
    // Map plan to tier (demo/starter -> starter, pro/professional -> pro, agency -> agency)
    let tier = 'starter';
    if (userPlan === 'professional' || userPlan === 'pro') {
      tier = 'pro';
    } else if (userPlan === 'agency') {
      tier = 'agency';
    }

    console.log('[exports/run] User plan:', userPlan, 'Tier:', tier);

    // Create export record immediately (with file_path = null to indicate processing)
    const { logDatasetExport } = await import('../db/exports.js');
    const exportRecord = await logDatasetExport({
      datasetId,
      userId,
      tier,
      format: format as 'csv' | 'xlsx',
      rowCount: 0, // Will be updated when export completes
      filePath: '', // Empty = processing
      watermarkText: `Dataset ${datasetId} – ${tier} export`
    });

    console.log('[exports/run] Created export record:', exportRecord.id);

    // Return export ID immediately (don't wait for processing)
    res.json({
      id: exportRecord.id,
      dataset_id: datasetId,
      format: format,
      tier: tier,
      status: 'processing',
      message: 'Export job created. Processing in background...'
    });

    // Process export asynchronously (don't await - let it run in background)
    processExportAsync(exportRecord.id, datasetId, tier, format, userId).catch(error => {
      console.error(`[exports/run] Error processing export ${exportRecord.id} async:`, error);
      // Update export record to mark as failed
      pool.query(
        'UPDATE exports SET file_path = NULL, total_rows = 0 WHERE id = $1',
        [exportRecord.id]
      ).catch(updateError => {
        console.error(`[exports/run] Failed to update export ${exportRecord.id} status:`, updateError);
      });
    });

  } catch (error: any) {
    console.error('[exports/run] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: error.message || 'Failed to create export job',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
});

/**
 * Process export asynchronously (runs in background)
 */
async function processExportAsync(
  exportId: string,
  datasetId: string,
  tier: string,
  format: 'csv' | 'xlsx',
  userId: string
): Promise<void> {
  try {
    console.log(`[processExportAsync] Starting export ${exportId} for dataset ${datasetId}`);

    // Before exporting, ensure crawl jobs are created for businesses with websites
    try {
      const { createCrawlJob } = await import('../db/crawlJobs.js');
      const { pool } = await import('../config/database.js');
      
      // Find businesses in this dataset that have websites but no crawl jobs or incomplete crawling
      const businessesNeedingCrawl = await pool.query<{ business_id: number; website_id: number }>(
        `SELECT DISTINCT b.id AS business_id, w.id AS website_id
         FROM businesses b
         JOIN websites w ON w.business_id = b.id
         LEFT JOIN crawl_jobs cj ON cj.website_id = w.id AND cj.status IN ('pending', 'running', 'completed')
         WHERE b.dataset_id = $1
           AND (cj.id IS NULL OR (cj.status = 'completed' AND w.last_crawled_at IS NULL))
         LIMIT 50`,
        [datasetId]
      );

      if (businessesNeedingCrawl.rows.length > 0) {
        console.log(`[processExportAsync] Creating ${businessesNeedingCrawl.rows.length} crawl jobs for businesses with websites...`);
        let crawlJobsCreated = 0;
        for (const row of businessesNeedingCrawl.rows) {
          try {
            await createCrawlJob(row.website_id, 'discovery', 25);
            crawlJobsCreated++;
          } catch (error: any) {
            // If crawl job already exists, skip
            if (error.code !== '23505') {
              console.error(`[processExportAsync] Error creating crawl job for website ${row.website_id}:`, error.message);
            }
          }
        }
        console.log(`[processExportAsync] Created ${crawlJobsCreated} crawl jobs`);
      }
    } catch (error) {
      console.error('[processExportAsync] Error creating crawl jobs:', error);
      // Continue anyway
    }

    // CRITICAL: Wait for all crawl and extraction jobs to complete before exporting
    console.log(`[processExportAsync] Waiting for crawl and extraction jobs to complete for export ${exportId}...`);
    const waitResult = await waitForDatasetJobsComplete(datasetId, 300); // Wait up to 5 minutes
    
    if (!waitResult.completed) {
      console.warn(`[processExportAsync] ⚠️  Export ${exportId} proceeding with incomplete data after ${waitResult.waitedSeconds}s timeout:`, {
        pendingCrawlJobs: waitResult.finalStatus.pendingCrawlJobs,
        runningCrawlJobs: waitResult.finalStatus.runningCrawlJobs,
        pendingExtractionJobs: waitResult.finalStatus.pendingExtractionJobs,
        runningExtractionJobs: waitResult.finalStatus.runningExtractionJobs
      });
    } else {
      console.log(`[processExportAsync] ✅ All jobs completed after ${waitResult.waitedSeconds}s - proceeding with export ${exportId}`);
    }

    // Generate export
    const filePath = await runDatasetExport(datasetId, tier, format);
    console.log(`[processExportAsync] Export ${exportId} generated:`, filePath);

    // Update export record with file path and row count
    const { getDatasetById } = await import('../db/datasets.js');
    const dataset = await getDatasetById(datasetId);
    if (dataset) {
      // Count businesses in dataset for total_rows
      const countResult = await pool.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM businesses WHERE dataset_id = $1',
        [datasetId]
      );
      const totalRows = parseInt(countResult.rows[0]?.count.toString() || '0');

      await pool.query(
        'UPDATE exports SET file_path = $1, total_rows = $2 WHERE id = $3',
        [filePath, totalRows, exportId]
      );
      console.log(`[processExportAsync] Export ${exportId} updated with file_path and ${totalRows} rows`);
    }

  } catch (error: any) {
    console.error(`[processExportAsync] Error processing export ${exportId}:`, error);
    // Mark export as failed (file_path stays empty/null)
    await pool.query(
      'UPDATE exports SET total_rows = 0 WHERE id = $1',
      [exportId]
    ).catch(updateError => {
      console.error(`[processExportAsync] Failed to update export ${exportId} status:`, updateError);
    });
  }
}

/**
 * GET /exports/:id/status
 * Get export status (processing or completed)
 */
router.get('/:id/status', authMiddleware, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const exportId = req.params.id;

    // Verify export belongs to user
    const exportResult = await pool.query<{
      id: string;
      file_path: string | null;
      total_rows: number;
      file_format: 'csv' | 'xlsx';
      created_at: Date;
    }>(
      'SELECT id, file_path, total_rows, file_format, created_at FROM exports WHERE id = $1 AND user_id = $2',
      [exportId, userId]
    );

    if (exportResult.rows.length === 0) {
      res.status(404).json({ error: 'Export not found' });
      return;
    }

    const exportRow = exportResult.rows[0];
    const isProcessing = !exportRow.file_path || exportRow.file_path.trim() === '';
    const status = isProcessing ? 'processing' : 'completed';

    res.json({
      id: exportId,
      status: status,
      total_rows: exportRow.total_rows,
      format: exportRow.file_format,
      created_at: exportRow.created_at.toISOString(),
      download_available: !isProcessing && fs.existsSync(exportRow.file_path || '')
    });
  } catch (error: any) {
    console.error('[API] Error checking export status:', error);
    res.status(500).json({ error: 'Failed to check export status' });
  }
});

/**
 * GET /exports/:id/download
 * Download an export file
 */
router.get('/:id/download', authMiddleware, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const exportId = req.params.id;

    // Verify export belongs to user
    const exportResult = await pool.query<{
      id: string;
      user_id: string;
      file_path: string;
      file_format: 'csv' | 'xlsx';
    }>(
      'SELECT id, user_id, file_path, file_format FROM exports WHERE id = $1 AND user_id = $2',
      [exportId, userId]
    );

    if (exportResult.rows.length === 0) {
      res.status(404).json({ error: 'Export not found' });
      return;
    }

    const exportRow = exportResult.rows[0];
    
    // Check if file exists and is ready (not processing)
    if (!exportRow.file_path || exportRow.file_path.trim() === '') {
      res.status(202).json({ 
        error: 'Export is still processing',
        status: 'processing',
        message: 'Please wait for the export to complete before downloading'
      });
      return;
    }
    
    if (!fs.existsSync(exportRow.file_path)) {
      res.status(404).json({ error: 'Export file not found' });
      return;
    }

    // Set appropriate headers
    const filename = `export-${exportId}.${exportRow.file_format}`;
    res.setHeader('Content-Type', exportRow.file_format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream the file
    const fileStream = fs.createReadStream(exportRow.file_path);
    fileStream.pipe(res);
    
    // Handle stream errors
    fileStream.on('error', (error) => {
      console.error('[API] File stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream export file' });
      }
    });
  } catch (error: any) {
    console.error('[API] Error downloading export:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download export' });
    }
  }
});

export default router;
