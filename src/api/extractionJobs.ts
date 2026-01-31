import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import { verifyDatasetOwnership } from '../db/datasets.js';
import { getExtractionJobsByDiscoveryRunId } from '../db/extractionJobs.js';

const router = express.Router();

/**
 * GET /extraction-jobs
 * Get extraction jobs for a dataset or discovery run
 * Query params: datasetId (optional), discoveryRunId (optional)
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const datasetId = req.query.datasetId as string | undefined;
    const discoveryRunId = req.query.discoveryRunId as string | undefined;

    if (!datasetId && !discoveryRunId) {
      return res.status(400).json({
        data: [],
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'datasetId or discoveryRunId is required',
        },
      });
    }

    // If discoveryRunId is provided, verify ownership through dataset
    if (discoveryRunId) {
      // Get discovery run to find dataset_id
      const discoveryRunResult = await pool.query<{ dataset_id: string; user_id: string }>(
        'SELECT dataset_id, user_id FROM discovery_runs WHERE id = $1',
        [discoveryRunId]
      );

      if (discoveryRunResult.rows.length === 0) {
        return res.status(404).json({
          data: [],
          meta: {
            plan_id: 'demo',
            gated: false,
            total_available: 0,
            total_returned: 0,
            gate_reason: 'Discovery run not found',
          },
        });
      }

      const runDatasetId = discoveryRunResult.rows[0].dataset_id;
      const runUserId = discoveryRunResult.rows[0].user_id;

      // Verify ownership
      if (runUserId !== userId) {
        const ownsDataset = await verifyDatasetOwnership(runDatasetId, userId);
        if (!ownsDataset) {
          return res.status(403).json({
            data: [],
            meta: {
              plan_id: 'demo',
              gated: false,
              total_available: 0,
              total_returned: 0,
              gate_reason: 'Access denied',
            },
          });
        }
      }

      // Get extraction jobs for this discovery run
      const extractionJobs = await getExtractionJobsByDiscoveryRunId(discoveryRunId);

      // Get user's plan
      const userResult = await pool.query<{ plan: string }>(
        'SELECT plan FROM users WHERE id = $1',
        [userId]
      );
      const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

      return res.json({
        data: extractionJobs.map(job => ({
          id: job.id,
          business_id: job.business_id,
          status: job.status,
          error_message: job.error_message,
          created_at: job.created_at instanceof Date ? job.created_at.toISOString() : job.created_at,
          started_at: job.started_at instanceof Date ? job.started_at.toISOString() : job.started_at,
          completed_at: job.completed_at instanceof Date ? job.completed_at.toISOString() : job.completed_at,
        })),
        meta: {
          plan_id: userPlan,
          gated: false,
          total_available: extractionJobs.length,
          total_returned: extractionJobs.length,
        },
      });
    }

    // If datasetId is provided, get all extraction jobs for businesses in that dataset
    if (datasetId) {
      // Verify dataset ownership
      const ownsDataset = await verifyDatasetOwnership(datasetId, userId);
      if (!ownsDataset) {
        return res.status(403).json({
          data: [],
          meta: {
            plan_id: 'demo',
            gated: false,
            total_available: 0,
            total_returned: 0,
            gate_reason: 'Dataset not found or access denied',
          },
        });
      }

      // Get extraction jobs for businesses in this dataset
      const result = await pool.query<{
        id: string;
        business_id: number;
        status: string;
        error_message: string | null;
        created_at: Date;
        started_at: Date | null;
        completed_at: Date | null;
      }>(
        `SELECT ej.id, ej.business_id, ej.status, ej.error_message, 
                ej.created_at, ej.started_at, ej.completed_at
         FROM extraction_jobs ej
         JOIN businesses b ON b.id = ej.business_id
         WHERE b.dataset_id = $1
         ORDER BY ej.created_at DESC`,
        [datasetId]
      );

      // Get user's plan
      const userResult = await pool.query<{ plan: string }>(
        'SELECT plan FROM users WHERE id = $1',
        [userId]
      );
      const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

      return res.json({
        data: result.rows.map(job => ({
          id: job.id,
          business_id: job.business_id,
          status: job.status,
          error_message: job.error_message,
          created_at: job.created_at instanceof Date ? job.created_at.toISOString() : job.created_at,
          started_at: job.started_at instanceof Date ? job.started_at.toISOString() : job.started_at,
          completed_at: job.completed_at instanceof Date ? job.completed_at.toISOString() : job.completed_at,
        })),
        meta: {
          plan_id: userPlan,
          gated: false,
          total_available: result.rows.length,
          total_returned: result.rows.length,
        },
      });
    }

    // This should never be reached due to the check at the top, but TypeScript needs it
    return res.status(400).json({
      data: [],
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: 'datasetId or discoveryRunId is required',
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching extraction jobs:', error);
    return res.status(500).json({
      data: [],
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch extraction jobs',
      },
    });
  }
});

export default router;
