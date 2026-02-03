import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import * as fs from 'fs';
import * as path from 'path';

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
    const protocol = req.protocol || 'http';
    const host = req.get('host') || process.env.API_BASE_URL || 'localhost:3001';
    const baseUrl = process.env.API_BASE_URL || `${protocol}://${host}`;
    
    const exports = result.rows.map(row => {
      const filters = row.filters || {};
      const tier = filters.tier || 'starter';
      
      return {
        id: row.id,
        dataset_id: filters.datasetId || '',
        format: row.file_format,
        tier: tier as 'starter' | 'pro' | 'agency',
        total_rows: row.total_rows,
        rows_returned: row.total_rows, // Same as total_rows for now
        rows_total: row.total_rows,
        file_path: row.file_path,
        download_url: row.file_path ? `${baseUrl}/exports/${row.id}/download` : null,
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
 * GET /exports/:id/download
 * Download an export file
 */
router.get('/:id/download', authMiddleware, async (req: AuthRequest, res) => {
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
      return res.status(404).json({ error: 'Export not found' });
    }

    const exportRow = exportResult.rows[0];
    
    // Check if file exists
    if (!exportRow.file_path || !fs.existsSync(exportRow.file_path)) {
      return res.status(404).json({ error: 'Export file not found' });
    }

    // Set appropriate headers
    const filename = `export-${exportId}.${exportRow.file_format}`;
    res.setHeader('Content-Type', exportRow.file_format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream the file
    const fileStream = fs.createReadStream(exportRow.file_path);
    fileStream.pipe(res);
  } catch (error: any) {
    console.error('[API] Error downloading export:', error);
    res.status(500).json({ error: 'Failed to download export' });
  }
});

export default router;
