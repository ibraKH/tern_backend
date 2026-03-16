import express, { Request, Response } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { getRecentActivity } from '../services/collab/activity.service';
import {
  createComment,
  deleteComment,
  getComments,
  resolveComment,
} from '../services/collab/comments.service';
import { AppError } from '../errors';

const collab = express.Router();

function handleAppError(res: Response, err: unknown) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('[collab] unexpected error:', err);
  return res.status(500).json({ error: 'Internal server error' });
}

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

/**
 * GET /collab/:modelName/comments
 */
collab.get(
  '/:modelName/comments',
  requireAuth,
  async (req: Request, res: Response) => {
    const { modelName } = req.params as { modelName: string };

    if (!modelName || modelName.trim().length === 0) {
      return res.status(400).json({ error: 'modelName must be a non-empty string' });
    }

    try {
      const comments = await getComments(modelName.trim());
      return res.json({ comments });
    } catch (err) {
      return handleAppError(res, err);
    }
  }
);

/**
 * POST /collab/:modelName/comments
 */
collab.post(
  '/:modelName/comments',
  requireAuth,
  async (req: Request, res: Response) => {
    const { modelName } = req.params as { modelName: string };
    const { entityType, entityId, body } = req.body ?? {};
    const user = (req as any).user;

    if (!modelName || modelName.trim().length === 0) {
      return res.status(400).json({ error: 'modelName must be a non-empty string' });
    }

    if (typeof body !== 'string' || body.trim().length === 0) {
      return res.status(400).json({ error: 'body must be a non-empty string' });
    }

    if (body.length > 2000) {
      return res.status(400).json({ error: 'body must be 2000 characters or less' });
    }

    if (entityType !== null && entityType !== undefined) {
      if (entityType !== 'node' && entityType !== 'edge') {
        return res.status(400).json({ error: "entityType must be 'node' or 'edge' or null" });
      }
    }

    try {
      const comment = await createComment({
        modelName: modelName.trim(),
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        authorId: user.id,
        body,
      });
      return res.status(201).json({ comment });
    } catch (err) {
      return handleAppError(res, err);
    }
  }
);

/**
 * PATCH /collab/:modelName/comments/:id/resolve
 */
collab.patch(
  '/:modelName/comments/:id/resolve',
  requireAuth,
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;

    const commentId = Number(id);
    if (!Number.isInteger(commentId) || commentId <= 0) {
      return res.status(400).json({ error: 'Invalid comment id' });
    }

    try {
      await resolveComment(commentId, user.id, user.role);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return handleAppError(res, err);
    }
  }
);

/**
 * DELETE /collab/:modelName/comments/:id
 */
collab.delete(
  '/:modelName/comments/:id',
  requireAuth,
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;

    const commentId = Number(id);
    if (!Number.isInteger(commentId) || commentId <= 0) {
      return res.status(400).json({ error: 'Invalid comment id' });
    }

    try {
      await deleteComment(commentId, user.id, user.role);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return handleAppError(res, err);
    }
  }
);

export default collab;
