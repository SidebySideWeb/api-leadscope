import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getDiscoveryRunsByDatasetId } from '../db/discoveryRuns.js';
import { getDatasetById, verifyDatasetOwnership } from '../db/datasets.js';

const router = express.Router();

/**
 * GET /refresh?dataset_id=:datasetId
 * Get discovery runs for a dataset
 * Requires authentication and dataset ownership
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const datasetId = req.query.dataset_id as string;

    if (!datasetId) {
      return res.status(400).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'dataset_id query parameter is required',
        },
      });
    }

    // Verify dataset ownership
    const dataset = await getDatasetById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Dataset not found',
        },
      });
    }

    const isOwner = await verifyDatasetOwnership(datasetId, userId);
    if (!isOwner) {
      return res.status(403).json({
        data: null,
        meta: {
          plan_id: 'demo',
          gated: false,
          total_available: 0,
          total_returned: 0,
          gate_reason: 'Access denied: You do not own this dataset',
        },
      });
    }

    // Get discovery runs for this dataset
    const discoveryRuns = await getDiscoveryRunsByDatasetId(datasetId);

    // Get user's plan for response
    const { pool } = await import('../config/database.js');
    const userResult = await pool.query<{ plan: string }>(
      'SELECT plan FROM users WHERE id = $1',
      [userId]
    );
    const userPlan = (userResult.rows[0]?.plan || 'demo') as string;

    return res.json({
      data: discoveryRuns.map(run => ({
        id: run.id,
        status: run.status,
        created_at: run.created_at instanceof Date ? run.created_at.toISOString() : run.created_at,
        completed_at: run.completed_at instanceof Date ? run.completed_at.toISOString() : run.completed_at,
        // Include cost estimates if available (ESTIMATES ONLY - no billing occurs)
        cost_estimates: run.cost_estimates || null,
      })),
      meta: {
        plan_id: userPlan,
        gated: false,
        total_available: discoveryRuns.length,
        total_returned: discoveryRuns.length,
      },
    });
  } catch (error: any) {
    console.error('[API] Error in refresh endpoint:', error);
    console.error('[API] Error stack:', error.stack);
    console.error('[API] Error code:', error.code);
    console.error('[API] Error detail:', error.detail);
    return res.status(500).json({
      data: null,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error.message || error.detail || 'Failed to get discovery runs',
      },
    });
  }
});

export default router;
