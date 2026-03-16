import express, { Request, Response } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { getRecentActivity } from '../services/collab/activity.service';

const collab = express.Router();

/**
 * GET /collab/:modelName/activity
 * Returns the recent activity log for a model.
 * Requires authentication (all roles).
 * Query param: ?limit=N  (integer 1–100, default 20)
 */
collab.get(
  '/:modelName/activity',
  requireAuth,
  async (req: Request, res: Response) => {
    const { modelName } = req.params as { modelName: string };

    // Validate modelName
    if (!modelName || modelName.trim().length === 0) {
      return res.status(400).json({ error: 'modelName must be a non-empty string' });
    }

    // Parse and clamp limit
    const rawLimit = req.query.limit;
    let limit = 20;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        limit = 20;
      } else {
        limit = Math.min(parsed, 100);
      }
    }

    try {
      const entries = await getRecentActivity(modelName.trim(), limit);
      return res.json({ entries });
    } catch (err) {
      console.error('[collab] GET activity failed:', err);
      return res.status(500).json({ error: 'Failed to fetch activity log' });
    }
  }
);

export default collab;
