import express from 'express';
import type { Request, Response } from 'express';

import pool from '../config/database';
import { getModelLockStatus } from '../services/models/reviewLock.service';
import { getModelRole } from '../services/permissions/model-permissions.service';
import { requireModelRole } from '../middlewares/model-permission.middleware';
import { MODEL_ROLES, GLOBAL_ROLES } from '../constants/roles';

type AuthedRequest = Request & { user?: { id: number; email: string; role: string } };

const LOCK_TTL_SECONDS = 120;

const locks = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Locks
 *     description: REST-based collaborative editing locks for STM models
 */

/**
 * @openapi
 * /models/{name}/lock/acquire:
 *   post:
 *     summary: Acquire or refresh an exclusive editing lock on a model
 *     description: >
 *       Only users with owner, editor, or reviewer model role can acquire locks.
 *       Viewers cannot acquire locks. lock_type is 'review' for reviewers, 'edit' otherwise.
 *     tags: [Locks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Lock acquired, refreshed, or already held by another user
 *       403:
 *         description: Model is locked for review, or Viewer role
 *       404:
 *         description: Model not found
 *       500:
 *         description: Internal server error
 */
locks.post(
  '/:name/lock/acquire',
  requireModelRole([MODEL_ROLES.OWNER, MODEL_ROLES.EDITOR, MODEL_ROLES.REVIEWER]),
  async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user!;
    const { name } = req.params as { name: string };

    try {
      const reviewLock = await getModelLockStatus(name);
      if (reviewLock?.is_locked) {
        return res.status(403).json({ error: 'Model is locked for review', ...reviewLock });
      }

      const modelRes = await pool.query<{ id: number }>('SELECT id FROM stmmodel WHERE stm_name = $1', [name]);
      if (modelRes.rows.length === 0) return res.status(404).json({ error: 'Model not found' });
      const modelId = modelRes.rows[0].id;

      // Determine lock_type from the user's model role.
      // Admins default to 'edit'; reviewers get 'review'; owners/editors get 'edit'.
      let lockType: 'edit' | 'review' = 'edit';
      if (user.role !== GLOBAL_ROLES.ADMIN) {
        const modelRole = await getModelRole(name, user.email);
        if (modelRole === MODEL_ROLES.REVIEWER) {
          lockType = 'review';
        }
      }

      const existing = await pool.query<{
        id: number; user_id: number; expires_at: string; email: string; lock_type: string;
      }>(
        `SELECT cl.id, cl.user_id, cl.expires_at, au.email, cl.lock_type
         FROM collab_locks cl JOIN auth_users au ON au.id = cl.user_id
         WHERE cl.model_id = $1 AND cl.entity_type = 'model' AND cl.entity_id = $2`,
        [modelId, modelId]
      );

      if (existing.rows.length > 0) {
        const lock = existing.rows[0];
        const expired = new Date(lock.expires_at) <= new Date();

        if (lock.user_id === user.id) {
          await pool.query(
            `UPDATE collab_locks SET expires_at = NOW() + INTERVAL '${LOCK_TTL_SECONDS} seconds', locked_at = NOW(), lock_type = $1
             WHERE id = $2`,
            [lockType, lock.id]
          );
          return res.json({
            success: true, locked: true,
            lockId: String(lock.id), lockedBy: user.email, owner: true,
            lock_type: lockType,
            expiresAt: new Date(Date.now() + LOCK_TTL_SECONDS * 1000).toISOString(),
          });
        }

        if (!expired) {
          return res.json({
            success: false, locked: true,
            lockId: String(lock.id), lockedBy: lock.email, owner: false,
            lock_type: lock.lock_type,
            expiresAt: lock.expires_at,
          });
        }

        await pool.query(
          `UPDATE collab_locks SET user_id = $1, locked_at = NOW(), expires_at = NOW() + INTERVAL '${LOCK_TTL_SECONDS} seconds', lock_type = $2
           WHERE id = $3`,
          [user.id, lockType, lock.id]
        );
        return res.json({
          success: true, locked: true,
          lockId: String(lock.id), lockedBy: user.email, owner: true,
          lock_type: lockType,
          expiresAt: new Date(Date.now() + LOCK_TTL_SECONDS * 1000).toISOString(),
        });
      }

      const insertRes = await pool.query<{ id: number; expires_at: string }>(
        `INSERT INTO collab_locks (model_id, user_id, entity_type, entity_id, expires_at, lock_type)
         VALUES ($1, $2, 'model', $3, NOW() + INTERVAL '${LOCK_TTL_SECONDS} seconds', $4)
         RETURNING id, expires_at`,
        [modelId, user.id, modelId, lockType]
      );

      return res.json({
        success: true, locked: true,
        lockId: String(insertRes.rows[0].id), lockedBy: user.email, owner: true,
        lock_type: lockType,
        expiresAt: insertRes.rows[0].expires_at,
      });
    } catch (err) {
      console.error('[locks] acquire failed:', err);
      return res.status(500).json({ error: 'Failed to acquire lock' });
    }
  },
);

/**
 * @openapi
 * /models/{name}/lock/renew:
 *   post:
 *     summary: Renew an existing model editing lock
 *     tags: [Locks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lockId]
 *             properties:
 *               lockId: { type: string }
 *     responses:
 *       200:
 *         description: Lock renewed
 *       400:
 *         description: Missing lockId
 *       403:
 *         description: Model is locked for review
 *       404:
 *         description: Lock not found or not owned by caller
 *       500:
 *         description: Internal server error
 */
locks.post('/:name/lock/renew', async (req: Request, res: Response) => {
  const user = (req as AuthedRequest).user!;
  const { name } = req.params as { name: string };
  const { lockId } = req.body as { lockId?: string };
  if (!lockId) return res.status(400).json({ error: 'lockId is required' });

  try {
    const reviewLock = await getModelLockStatus(name);
    if (reviewLock?.is_locked) {
      return res.status(403).json({ error: 'Model is locked for review', ...reviewLock });
    }

    const result = await pool.query<{ id: number; expires_at: string }>(
      `UPDATE collab_locks SET expires_at = NOW() + INTERVAL '${LOCK_TTL_SECONDS} seconds', locked_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, expires_at`,
      [Number(lockId), user.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Lock not found or not owned by you' });

    return res.json({
      success: true, locked: true,
      lockId, lockedBy: user.email, owner: true,
      expiresAt: result.rows[0].expires_at,
    });
  } catch (err) {
    console.error('[locks] renew failed:', err);
    return res.status(500).json({ error: 'Failed to renew lock' });
  }
});

/**
 * @openapi
 * /models/{name}/lock/release:
 *   post:
 *     summary: Release a model editing lock
 *     tags: [Locks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lockId]
 *             properties:
 *               lockId: { type: string }
 *     responses:
 *       200:
 *         description: Lock released
 *       400:
 *         description: Missing lockId
 *       500:
 *         description: Internal server error
 */
locks.post('/:name/lock/release', async (req: Request, res: Response) => {
  const user = (req as AuthedRequest).user!;
  const { lockId } = req.body as { lockId?: string };
  if (!lockId) return res.status(400).json({ error: 'lockId is required' });

  try {
    await pool.query(
      'DELETE FROM collab_locks WHERE id = $1 AND user_id = $2',
      [Number(lockId), user.id]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('[locks] release failed:', err);
    return res.status(500).json({ error: 'Failed to release lock' });
  }
});

/**
 * @openapi
 * /models/{name}/lock:
 *   get:
 *     summary: Check the current lock status of a model (includes lock_type)
 *     tags: [Locks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Lock status
 *       404:
 *         description: Model not found
 *       500:
 *         description: Internal server error
 */
locks.get('/:name/lock', async (req: Request, res: Response) => {
  const user = (req as AuthedRequest).user!;
  const { name } = req.params as { name: string };

  try {
    const modelRes = await pool.query<{ id: number }>('SELECT id FROM stmmodel WHERE stm_name = $1', [name]);
    if (modelRes.rows.length === 0) return res.status(404).json({ error: 'Model not found' });
    const modelId = modelRes.rows[0].id;

    const result = await pool.query<{
      id: number; user_id: number; expires_at: string; email: string; lock_type: string;
    }>(
      `SELECT cl.id, cl.user_id, cl.expires_at, au.email, cl.lock_type
       FROM collab_locks cl JOIN auth_users au ON au.id = cl.user_id
       WHERE cl.model_id = $1 AND cl.entity_type = 'model' AND cl.entity_id = $2
         AND cl.expires_at > NOW()`,
      [modelId, modelId]
    );

    if (result.rows.length === 0) {
      return res.json({ locked: false });
    }

    const lock = result.rows[0];
    return res.json({
      locked: true,
      lockId: String(lock.id),
      lockedBy: lock.email,
      expiresAt: lock.expires_at,
      owner: lock.user_id === user.id,
      lock_type: lock.lock_type,
    });
  } catch (err) {
    console.error('[locks] get lock status failed:', err);
    return res.status(500).json({ error: 'Failed to check lock status' });
  }
});

export default locks;
