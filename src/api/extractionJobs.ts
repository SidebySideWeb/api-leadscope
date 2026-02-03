import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import { verifyDatasetOwnership } from '../db/datasets.js';
import { getExtractionJobsByDiscoveryRunId } from '../db/extractionJobs.js';
import { createExtractionJob } from '../db/extractionJobs.js';
import { runExtractionBatch } from '../workers/extractWorker.js';

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
        business_id: string;
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

/**
 * GET /extraction-jobs/stats
 * Get extraction job statistics for a dataset
 * Query params: datasetId (required)
 */
router.get('/stats', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const datasetId = req.query.datasetId as string | undefined;

    if (!datasetId) {
      return res.status(400).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'datasetId is required',
        },
      });
    }

    // Verify dataset ownership
    const ownsDataset = await verifyDatasetOwnership(datasetId, userId);
    if (!ownsDataset) {
      return res.status(403).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Dataset not found or access denied',
        },
      });
    }

    // Get extraction job statistics
    const statsResult = await pool.query<{
      total: string;
      pending: string;
      running: string;
      success: string;
      failed: string;
    }>(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ej.status = 'pending') as pending,
        COUNT(*) FILTER (WHERE ej.status = 'running') as running,
        COUNT(*) FILTER (WHERE ej.status = 'success') as success,
        COUNT(*) FILTER (WHERE ej.status = 'failed') as failed
      FROM extraction_jobs ej
      JOIN businesses b ON b.id = ej.business_id
      WHERE b.dataset_id = $1`,
      [datasetId]
    );

    // Get user's plan
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

    const stats = statsResult.rows[0];

    return res.json({
      data: {
        total: parseInt(stats.total || '0', 10),
        pending: parseInt(stats.pending || '0', 10),
        running: parseInt(stats.running || '0', 10),
        success: parseInt(stats.success || '0', 10),
        failed: parseInt(stats.failed || '0', 10),
      },
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: 1,
        total_returned: 1,
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching extraction stats:', error);
    return res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to fetch extraction stats',
      },
    });
  }
});

/**
 * POST /extraction-jobs
 * Manually trigger extraction for a business or dataset
 * Body: { businessId?: string, datasetId?: string }
 */
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { businessId, datasetId } = req.body;

    if (!businessId && !datasetId) {
      return res.status(400).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'businessId or datasetId is required',
        },
      });
    }

    // Get user's plan
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

    if (businessId) {
      // Verify business ownership
      const businessResult = await pool.query<{ dataset_id: string }>(
        'SELECT dataset_id FROM businesses WHERE id = $1',
        [businessId]
      );

      if (businessResult.rows.length === 0) {
        return res.status(404).json({
          data: null,
          meta: {
            plan_id: userPlan,
            gated: false,
            total_available: 0,
            total_returned: 0,
            gate_reason: 'Business not found',
          },
        });
      }

      const ownsDataset = await verifyDatasetOwnership(businessResult.rows[0].dataset_id, userId);
      if (!ownsDataset) {
        return res.status(403).json({
          data: null,
          meta: {
            plan_id: userPlan,
            gated: false,
            total_available: 0,
            total_returned: 0,
            gate_reason: 'Access denied',
          },
        });
      }

      // Check if extraction job already exists
      const existingJob = await pool.query<{ id: string }>(
        'SELECT id FROM extraction_jobs WHERE business_id = $1',
        [businessId]
      );

      if (existingJob.rows.length > 0) {
        return res.json({
          data: {
            id: existingJob.rows[0].id,
            business_id: businessId,
            message: 'Extraction job already exists',
          },
          meta: {
            plan_id: userPlan,
            gated: false,
            total_available: 1,
            total_returned: 1,
          },
        });
      }

      // Create extraction job
      const job = await createExtractionJob(businessId);

      // Trigger extraction worker (process immediately)
      runExtractionBatch(1).catch(error => {
        console.error('[API] Error processing extraction batch:', error);
      });

      return res.json({
        data: {
          id: job.id,
          business_id: job.business_id,
          status: job.status,
          message: 'Extraction job created and queued',
        },
        meta: {
          plan_id: userPlan,
          gated: false,
          total_available: 1,
          total_returned: 1,
        },
      });
    }

    if (datasetId) {
      // Verify dataset ownership
      const ownsDataset = await verifyDatasetOwnership(datasetId, userId);
      if (!ownsDataset) {
        return res.status(403).json({
          data: null,
          meta: {
            plan_id: userPlan,
            gated: false,
            total_available: 0,
            total_returned: 0,
            gate_reason: 'Dataset not found or access denied',
          },
        });
      }

      // Get businesses without extraction jobs
      const businessesResult = await pool.query<{ id: number }>(
        `SELECT b.id
         FROM businesses b
         LEFT JOIN extraction_jobs ej ON ej.business_id = b.id
         WHERE b.dataset_id = $1 AND ej.id IS NULL
         LIMIT 100`,
        [datasetId]
      );

      const createdJobs = [];
      for (const business of businessesResult.rows) {
        const job = await createExtractionJob(business.id);
        createdJobs.push({
          id: job.id,
          business_id: job.business_id.toString(),
          status: job.status,
        });
      }

      // Trigger extraction worker
      runExtractionBatch(createdJobs.length).catch(error => {
        console.error('[API] Error processing extraction batch:', error);
      });

      return res.json({
        data: {
          jobs_created: createdJobs.length,
          jobs: createdJobs,
          message: `Created ${createdJobs.length} extraction jobs`,
        },
        meta: {
          plan_id: userPlan,
          gated: false,
          total_available: createdJobs.length,
          total_returned: createdJobs.length,
        },
      });
    }

    return res.status(400).json({
      data: null,
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: 'businessId or datasetId is required',
      },
    });
  } catch (error: any) {
    console.error('[API] Error creating extraction jobs:', error);
    return res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || 'Failed to create extraction jobs',
      },
    });
  }
});

export default router;
