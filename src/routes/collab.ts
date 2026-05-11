import express from 'express';
import type { Request, Response } from 'express';

import { requireAuth } from '../middlewares/auth.middleware';
import { requireAdmin } from '../middlewares/requireAdmin';
import { requireModelRole } from '../middlewares/model-permission.middleware';
import { getRecentActivity } from '../services/collab/activity.service';
import { createComment, getComments, resolveComment, deleteComment } from '../services/collab/comments.service';
import { createMilestone, listMilestones, getMilestone, deleteMilestone } from '../services/collab/milestones.service';
import { saveModel } from '../services/models/save.service';
import type { BMRGData } from '../types/models.types';
import { logActivity } from '../services/collab/activity.service';
import { io } from '../socket';
import { broadcastActivity } from '../collab/roomManager';
import { MODEL_ROLES } from '../constants/roles';

type AuthedRequest = Request & { user?: { id: number; email: string; role: string; contributor_id: number | null } };

const collab = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Collab
 *     description: Collaborative features — activity log, comments, and milestones per model
 */

// ── Activity Log ─────────────────────────────────────────────────────────────

/**
 * @openapi
 * /collab/{modelName}/activity:
 *   get:
 *     summary: Get recent activity log entries for a model
 *     tags: [Collab]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelName
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Activity entries
 *       400:
 *         description: Invalid modelName
 *       500:
 *         description: Internal server error
 */
collab.get(
  '/:modelName/activity',
  requireAuth,
  requireModelRole([MODEL_ROLES.OWNER, MODEL_ROLES.EDITOR, MODEL_ROLES.REVIEWER, MODEL_ROLES.VIEWER]),
  async (req: Request, res: Response) => {
    const { modelName } = req.params as { modelName: string };
    if (!modelName?.trim()) return res.status(400).json({ error: 'modelName must be a non-empty string' });

    const rawLimit = req.query.limit;
    let limit = 20;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      limit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
    }

    try {
      const entries = await getRecentActivity(modelName.trim(), limit);
      return res.json({ entries });
    } catch (err) {
      console.error('[collab] GET activity failed:', err);
      return res.status(500).json({ error: 'Failed to fetch activity log' });
    }
  },
);

// ── Comments ─────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /collab/{modelName}/comments:
 *   get:
 *     summary: Get paginated comments for a model
 *     tags: [Collab]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelName
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Paginated list of comments
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 comments:
 *                   type: array
 *                 total:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 offset:
 *                   type: integer
 *       500:
 *         description: Internal server error
 */
collab.get(
  '/:modelName/comments',
  requireAuth,
  requireModelRole([MODEL_ROLES.OWNER, MODEL_ROLES.EDITOR, MODEL_ROLES.REVIEWER, MODEL_ROLES.VIEWER]),
  async (req: Request, res: Response) => {
    const { modelName } = req.params as { modelName: string };

    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 50, 100);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

    try {
      const result = await getComments(modelName, limit, offset);
      return res.json(result);
    } catch (err) {
      console.error('[collab] GET comments failed:', err);
      return res.status(500).json({ error: 'Failed to fetch comments' });
    }
  },
);

/**
 * @openapi
 * /collab/{modelName}/comments:
 *   post:
 *     summary: Create a new comment on a model
 *     tags: [Collab]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelName
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body:
 *                 type: string
 *                 maxLength: 2000
 *               entityType:
 *                 type: string
 *                 enum: [node, edge]
 *                 nullable: true
 *               entityId:
 *                 type: integer
 *                 nullable: true
 *               parentId:
 *                 type: integer
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Comment created
 *       400:
 *         description: Missing body, body too long, or invalid entityType
 *       500:
 *         description: Internal server error
 */
collab.post(
  '/:modelName/comments',
  requireAuth,
  requireModelRole([MODEL_ROLES.OWNER, MODEL_ROLES.EDITOR, MODEL_ROLES.REVIEWER]),
  async (req: Request, res: Response) => {
    const { modelName } = req.params as { modelName: string };
    const user = (req as AuthedRequest).user!;
    const { entityType, entityId, body, parentId } = req.body as {
      entityType?: string; entityId?: number; body?: string; parentId?: number;
    };

    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'body is required and must be a non-empty string' });
    }
    if (body.length > 2000) {
      return res.status(400).json({ error: 'body must be at most 2000 characters' });
    }
    if (entityType !== undefined && entityType !== 'node' && entityType !== 'edge' && entityType !== null) {
      return res.status(400).json({ error: 'entityType must be "node", "edge", or null' });
    }

    try {
      const comment = await createComment({
        modelName, entityType: entityType ?? null, entityId: entityId ?? null,
        authorId: user.id, body: body.trim(), parentId: parentId ?? null,
      });

      const roomKey = `name:${modelName}`;
      io.to(roomKey).emit('comment:new', { comment, entityType: comment.entityType, entityId: comment.entityId });

      const entry = {
        id: 0, action: 'comment_added', entityType: comment.entityType, entityId: comment.entityId,
        detail: { body: comment.body.slice(0, 100) }, createdAt: comment.createdAt,
        user: { id: user.id, email: user.email },
      };
      broadcastActivity(io, roomKey, entry);
      void logActivity({ modelName, userId: user.id, action: 'comment_added', entityType: comment.entityType ?? undefined, entityId: comment.entityId ?? undefined });

      return res.status(201).json({ comment });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 500;
      return res.status(status).json({ error: (err as Error).message || 'Failed to create comment' });
    }
  },
);

/**
 * @openapi
 * /collab/{modelName}/comments/{id}/resolve:
 *   patch:
 *     summary: Mark a comment as resolved
 *     tags: [Collab]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelName
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Comment resolved
 *       403:
 *         description: Not the comment author or insufficient role
 *       500:
 *         description: Internal server error
 */
collab.patch(
  '/:modelName/comments/:id/resolve',
  requireAuth,
  requireModelRole([MODEL_ROLES.OWNER, MODEL_ROLES.EDITOR, MODEL_ROLES.REVIEWER]),
  async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user!;
    try {
      await resolveComment(Number(req.params.id), user.id, user.role);
      return res.json({ success: true });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 500;
      return res.status(status).json({ error: (err as Error).message });
    }
  },
);

/**
 * @openapi
 * /collab/{modelName}/comments/{id}:
 *   delete:
 *     summary: Delete a comment
 *     tags: [Collab]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelName
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Comment deleted
 *       403:
 *         description: Not the comment author or insufficient role
 *       500:
 *         description: Internal server error
 */
collab.delete(
  '/:modelName/comments/:id',
  requireAuth,
  requireModelRole([MODEL_ROLES.OWNER, MODEL_ROLES.EDITOR, MODEL_ROLES.REVIEWER]),
  async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user!;
    try {
      await deleteComment(Number(req.params.id), user.id, user.role);
      return res.json({ success: true });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 500;
      return res.status(status).json({ error: (err as Error).message });
    }
  },
);

// ── Milestones ───────────────────────────────────────────────────────────────

/**
 * @openapi
 * /collab/{modelName}/milestones:
 *   get:
 *     summary: List all milestones for a model
 *     tags: [Collab]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelName
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Milestone list
 *       500:
 *         description: Internal server error
 */
collab.get(
  '/:modelName/milestones',
  requireAuth,
  requireModelRole([MODEL_ROLES.OWNER, MODEL_ROLES.EDITOR, MODEL_ROLES.REVIEWER, MODEL_ROLES.VIEWER]),
  async (req: Request, res: Response) => {
    const { modelName } = req.params as { modelName: string };
    try {
      const milestones = await listMilestones(modelName);
      return res.json({ milestones });
    } catch (err) {
      console.error('[collab] GET milestones failed:', err);
      return res.status(500).json({ error: 'Failed to fetch milestones' });
    }
  },
);

/**
 * @openapi
 * /collab/{modelName}/milestones:
 *   post:
 *     summary: Create a new milestone snapshot for a model
 *     description: Requires Owner or Editor model role.
 *     tags: [Collab]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelName
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [label]
 *             properties:
 *               label:
 *                 type: string
 *                 maxLength: 100
 *     responses:
 *       201:
 *         description: Milestone created
 *       400:
 *         description: Missing or invalid label
 *       500:
 *         description: Internal server error
 */
collab.post(
  '/:modelName/milestones',
  requireAuth,
  requireModelRole([MODEL_ROLES.OWNER, MODEL_ROLES.EDITOR]),
  async (req: Request, res: Response) => {
    const { modelName } = req.params as { modelName: string };
    const user = (req as AuthedRequest).user!;
    const { label } = req.body as { label?: string };

    if (!label || typeof label !== 'string' || !label.trim()) {
      return res.status(400).json({ error: 'label is required' });
    }
    if (label.length > 100) {
      return res.status(400).json({ error: 'label must be at most 100 characters' });
    }

    try {
      const milestone = await createMilestone({ modelName, label: label.trim(), createdBy: user.id });

      const roomKey = `name:${modelName}`;
      io.to(roomKey).emit('milestone:created', milestone);

      void logActivity({ modelName, userId: user.id, action: 'milestone_created', detail: { label: milestone.label } });
      broadcastActivity(io, roomKey, {
        id: 0, action: 'milestone_created', entityType: null, entityId: null,
        detail: { label: milestone.label }, createdAt: milestone.createdAt,
        user: { id: user.id, email: user.email },
      });

      return res.status(201).json({ milestone });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 500;
      return res.status(status).json({ error: (err as Error).message });
    }
  },
);

/**
 * @openapi
 * /collab/{modelName}/milestones/{id}:
 *   get:
 *     summary: Get a single milestone by ID
 *     tags: [Collab]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelName
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Milestone found
 *       404:
 *         description: Milestone not found
 *       500:
 *         description: Internal server error
 */
collab.get(
  '/:modelName/milestones/:id',
  requireAuth,
  requireModelRole([MODEL_ROLES.OWNER, MODEL_ROLES.EDITOR, MODEL_ROLES.REVIEWER, MODEL_ROLES.VIEWER]),
  async (req: Request, res: Response) => {
    const { modelName, id } = req.params as { modelName: string; id: string };
    try {
      const milestone = await getMilestone(Number(id), modelName);
      if (!milestone) return res.status(404).json({ error: 'Milestone not found' });
      return res.json({ milestone });
    } catch {
      return res.status(500).json({ error: 'Failed to fetch milestone' });
    }
  },
);

/**
 * @openapi
 * /collab/{modelName}/milestones/{id}:
 *   delete:
 *     summary: Delete a milestone (Admin only)
 *     tags: [Collab]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelName
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Milestone deleted
 *       403:
 *         description: Insufficient role (Admin required)
 *       404:
 *         description: Milestone not found
 */
collab.delete(
  '/:modelName/milestones/:id',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const { modelName, id } = req.params as { modelName: string; id: string };
    const deleted = await deleteMilestone(Number(id), modelName);
    if (!deleted) return res.status(404).json({ error: 'Milestone not found' });
    return res.json({ success: true });
  },
);

/**
 * @openapi
 * /collab/{modelName}/milestones/{id}/restore:
 *   post:
 *     summary: Restore a model from a milestone snapshot (Owner or Editor model role required)
 *     tags: [Collab]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelName
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Model restored from milestone snapshot
 *       403:
 *         description: Insufficient role
 *       404:
 *         description: Milestone not found
 *       500:
 *         description: Internal server error
 */
collab.post(
  '/:modelName/milestones/:id/restore',
  requireAuth,
  requireModelRole([MODEL_ROLES.OWNER, MODEL_ROLES.EDITOR]),
  async (req: Request, res: Response) => {
    const { modelName, id } = req.params as { modelName: string; id: string };
    const user = (req as AuthedRequest).user!;

    try {
      const milestone = await getMilestone(Number(id), modelName);
      if (!milestone) return res.status(404).json({ error: 'Milestone not found' });

      await saveModel(milestone.snapshot as unknown as BMRGData);

      void logActivity({
        modelName, userId: user.id, action: 'model_restored',
        detail: { milestoneId: milestone.id, label: milestone.label },
      });

      const roomKey = `name:${modelName}`;
      io.to(roomKey).emit('model:restored', {
        milestoneId: milestone.id, label: milestone.label, restoredBy: user.email,
      });
      broadcastActivity(io, roomKey, {
        id: 0, action: 'model_restored', entityType: null, entityId: null,
        detail: { milestoneId: milestone.id, label: milestone.label }, createdAt: new Date().toISOString(),
        user: { id: user.id, email: user.email },
      });

      return res.json({ message: 'Model restored' });
    } catch (err: unknown) {
      console.error('[collab] restore failed:', err);
      const status = (err as { status?: number }).status ?? 500;
      const message = (err as { message?: string }).message ?? 'Failed to restore model';
      return res.status(status).json({ error: message });
    }
  },
);

export default collab;
