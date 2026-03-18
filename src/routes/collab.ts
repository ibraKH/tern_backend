import express, { Request, Response } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { validate } from '../validation/validate';
import { getRecentActivity } from '../services/collab/activity.service';
import {
  createComment,
  deleteComment,
  getComments,
  resolveComment,
} from '../services/collab/comments.service';
import { createCommentSchema } from '../validation/collab.schemas';

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

/**
 * GET /collab/:modelName/comments
 * Returns comments for a model (not deleted).
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
      console.error('[collab] GET comments failed:', err);
      return res.status(500).json({ error: 'Failed to fetch comments' });
    }
  }
);

/**
 * POST /collab/:modelName/comments
 * Create a new comment in a model.
 */
collab.post(
  '/:modelName/comments',
  requireAuth,
  validate({ body: createCommentSchema }),
  async (req: Request, res: Response) => {
    const { modelName } = req.params as { modelName: string };
    const { body, entityType, entityId } = req.body as { body: string; entityType?: 'node' | 'edge' | null; entityId?: number | null };
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    try {
      const comment = await createComment({
        modelName: modelName.trim(),
        body,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        authorId: user.id,
        authorEmail: user.email,
      });
      return res.status(201).json({ comment });
    } catch (err) {
      console.error('[collab] POST create comment failed:', err);
      if (err instanceof Error && (err as any).status) {
        return res.status((err as any).status).json({ error: (err as any).message });
      }
      return res.status(500).json({ error: 'Failed to create comment' });
    }
  }
);

/**
 * PATCH /collab/:modelName/comments/:id/resolve
 * Mark a comment as resolved.
 */
collab.patch(
  '/:modelName/comments/:id/resolve',
  requireAuth,
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    try {
      const updated = await resolveComment(Number(id), user.id, user.role);
      return res.json({ comment: updated });
    } catch (err) {
      console.error('[collab] PATCH resolve comment failed:', err);
      if (err instanceof Error && (err as any).status) {
        return res.status((err as any).status).json({ error: (err as any).message });
      }
      return res.status(500).json({ error: 'Failed to resolve comment' });
    }
  }
);

/**
 * DELETE /collab/:modelName/comments/:id
 * Soft-delete a comment.
 */
collab.delete(
  '/:modelName/comments/:id',
  requireAuth,
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: 'Missing authenticated user' });
    }

    try {
      await deleteComment(Number(id), user.id, user.role);
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[collab] DELETE comment failed:', err);
      if (err instanceof Error && (err as any).status) {
        return res.status((err as any).status).json({ error: (err as any).message });
      }
      return res.status(500).json({ error: 'Failed to delete comment' });
    }
  }
);

export default collab;
