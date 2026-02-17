import express from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getIndustryGroups, getIndustriesByGroup } from '../db/industryGroups.js';

const router = express.Router();

/**
 * GET /api/industry-groups
 * Get all industry groups (public endpoint - no auth required for listing)
 */
router.get('/', async (req, res) => {
  try {
    console.log('[API] GET /api/industry-groups - Request received');
    const groups = await getIndustryGroups();

    res.json({
      data: groups,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: groups.length,
        total_returned: groups.length,
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching industry groups:', error);
    res.status(500).json({
      data: [],
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error?.message || 'Failed to fetch industry groups',
      },
    });
  }
});

/**
 * GET /api/industry-groups/:groupId/industries
 * Get all industries in a specific industry group
 */
router.get('/:groupId/industries', async (req, res) => {
  try {
    const groupId = req.params.groupId;
    console.log('[API] GET /api/industry-groups/:groupId/industries - Request received for group:', groupId);
    
    const industries = await getIndustriesByGroup(groupId);

    res.json({
      data: industries,
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: industries.length,
        total_returned: industries.length,
      },
    });
  } catch (error: any) {
    console.error('[API] Error fetching industries for group:', error);
    res.status(500).json({
      data: [],
      meta: {
        plan_id: 'demo',
        gated: false,
        total_available: 0,
        total_returned: 0,
        gate_reason: error?.message || 'Failed to fetch industries for group',
      },
    });
  }
});

export default router;
