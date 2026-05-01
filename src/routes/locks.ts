import express from 'express';
import type { Request, Response } from 'express';

import { requireAuth } from '../middlewares/auth.middleware';
import pool from '../config/database';
import { getModelLockStatus } from '../services/models/reviewLock.service';

type AuthedRequest = Request & { user?: { id: number; email: string; role: string } };

const LOCK_TTL_SECONDS = 120;

const locks = express.Router();

/**
 * POST /models/:name/lock/acquire
 * Acquire an exclusive model-level editing lock (REST-based, used by frontend on model open).
 */
locks.post('/:name/lock/acquire', requireAuth, async (req: Request, res: Response) => {
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

    // Check existing model-level lock (entity_type = 'model', entity_id = model_id).
    const existing = await pool.query<{ id: number; user_id: number; expires_at: string; email: string }>(
      `SELECT cl.id, cl.user_id, cl.expires_at, au.email
       FROM collab_locks cl JOIN auth_users au ON au.id = cl.user_id
       WHERE cl.model_id = $1 AND cl.entity_type = 'model' AND cl.entity_id = $2`,
      [modelId, modelId]
    );

    if (existing.rows.length > 0) {
      const lock = existing.rows[0];
      const expired = new Date(lock.expires_at) <= new Date();

      if (lock.user_id === user.id) {
        // Same user — refresh.
        await pool.query(
          `UPDATE collab_locks SET expires_at = NOW() + INTERVAL '${LOCK_TTL_SECONDS} seconds', locked_at = NOW()
           WHERE id = $1`,
          [lock.id]
        );
        return res.json({
          success: true, locked: true,
          lockId: String(lock.id), lockedBy: user.email, owner: true,
          expiresAt: new Date(Date.now() + LOCK_TTL_SECONDS * 1000).toISOString(),
        });
      }

      if (!expired) {
        return res.json({
          success: false, locked: true,
          lockId: String(lock.id), lockedBy: lock.email, owner: false,
          expiresAt: lock.expires_at,
        });
      }

      // Expired — take it over.
      await pool.query(
        `UPDATE collab_locks SET user_id = $1, locked_at = NOW(), expires_at = NOW() + INTERVAL '${LOCK_TTL_SECONDS} seconds'
         WHERE id = $2`,
        [user.id, lock.id]
      );
      return res.json({
        success: true, locked: true,
        lockId: String(lock.id), lockedBy: user.email, owner: true,
        expiresAt: new Date(Date.now() + LOCK_TTL_SECONDS * 1000).toISOString(),
      });
    }

    // No lock — insert.
    const insertRes = await pool.query<{ id: number; expires_at: string }>(
      `INSERT INTO collab_locks (model_id, user_id, entity_type, entity_id, expires_at)
       VALUES ($1, $2, 'model', $3, NOW() + INTERVAL '${LOCK_TTL_SECONDS} seconds')
       RETURNING id, expires_at`,
      [modelId, user.id, modelId]
    );

    return res.json({
      success: true, locked: true,
      lockId: String(insertRes.rows[0].id), lockedBy: user.email, owner: true,
      expiresAt: insertRes.rows[0].expires_at,
    });
  } catch (err) {
    console.error('[locks] acquire failed:', err);
    return res.status(500).json({ error: 'Failed to acquire lock' });
  }
});

/**
 * POST /models/:name/lock/renew
 * Renew an existing model-level lock.
 */
locks.post('/:name/lock/renew', requireAuth, async (req: Request, res: Response) => {
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
 * POST /models/:name/lock/release
 * Release a model-level lock.
 */
locks.post('/:name/lock/release', requireAuth, async (req: Request, res: Response) => {
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
 * GET /models/:name/lock
 * Check current lock status for a model.
 */
locks.get('/:name/lock', requireAuth, async (req: Request, res: Response) => {
  const user = (req as AuthedRequest).user!;
  const { name } = req.params as { name: string };

  try {
    const modelRes = await pool.query<{ id: number }>('SELECT id FROM stmmodel WHERE stm_name = $1', [name]);
    if (modelRes.rows.length === 0) return res.status(404).json({ error: 'Model not found' });
    const modelId = modelRes.rows[0].id;

    const result = await pool.query<{ id: number; user_id: number; expires_at: string; email: string }>(
      `SELECT cl.id, cl.user_id, cl.expires_at, au.email
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
    });
  } catch (err) {
    console.error('[locks] get lock status failed:', err);
    return res.status(500).json({ error: 'Failed to check lock status' });
  }
});

export default locks;
