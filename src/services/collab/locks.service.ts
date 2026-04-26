import pool from '../../config/database';

export const LOCK_TTL_SECONDS = 30;
const VALID_ENTITY_TYPES = ['node', 'edge'] as const;

export interface AcquireLockParams {
  entityType: string;
  entityId: number;
  modelName: string;
  userId: number;
}

export interface AcquireLockResult {
  success: boolean;
  heldBy?: string; // email of the user holding the lock
}

export interface ReleasedLock {
  entityType: string;
  entityId: number;
  modelName: string;
}

function isValidEntityType(t: string): t is (typeof VALID_ENTITY_TYPES)[number] {
  return (VALID_ENTITY_TYPES as readonly string[]).includes(t);
}

function resolveModelId(modelName: string) {
  return pool.query<{ id: number }>(
    'SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1',
    [modelName]
  );
}

/**
 * Try to acquire an exclusive lock on an entity.
 * If the entity is already locked by someone else and the lock hasn't expired, returns {success: false, heldBy}.
 * If the entity is locked by the same user, refreshes the TTL.
 */
export async function acquireLock(params: AcquireLockParams): Promise<AcquireLockResult> {
  const { entityType, entityId, modelName, userId } = params;
  if (!isValidEntityType(entityType)) throw new Error(`Invalid entityType: ${entityType}`);

  const modelRes = await resolveModelId(modelName);
  if (modelRes.rows.length === 0) throw new Error(`Model not found: ${modelName}`);
  const modelId = modelRes.rows[0].id;

  // Check for an existing lock on this entity.
  const existing = await pool.query<{ user_id: number; expires_at: string; email: string }>(
    `SELECT cl.user_id, cl.expires_at, au.email
     FROM collab_locks cl
     JOIN auth_users au ON au.id = cl.user_id
     WHERE cl.model_id = $1 AND cl.entity_type = $2 AND cl.entity_id = $3`,
    [modelId, entityType, entityId]
  );

  if (existing.rows.length > 0) {
    const lock = existing.rows[0];
    const expired = new Date(lock.expires_at) <= new Date();

    if (lock.user_id === userId) {
      // Same user — refresh the TTL.
      await pool.query(
        `UPDATE collab_locks SET expires_at = NOW() + INTERVAL '${LOCK_TTL_SECONDS} seconds', locked_at = NOW()
         WHERE model_id = $1 AND entity_type = $2 AND entity_id = $3`,
        [modelId, entityType, entityId]
      );
      return { success: true };
    }

    if (!expired) {
      return { success: false, heldBy: lock.email };
    }

    // Expired lock by another user — take it over.
    await pool.query(
      `UPDATE collab_locks SET user_id = $1, locked_at = NOW(), expires_at = NOW() + INTERVAL '${LOCK_TTL_SECONDS} seconds'
       WHERE model_id = $2 AND entity_type = $3 AND entity_id = $4`,
      [userId, modelId, entityType, entityId]
    );
    return { success: true };
  }

  // No existing lock — insert a new one.
  await pool.query(
    `INSERT INTO collab_locks (model_id, user_id, entity_type, entity_id, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '${LOCK_TTL_SECONDS} seconds')`,
    [modelId, userId, entityType, entityId]
  );
  return { success: true };
}

/**
 * Release a lock held by a specific user. No-op if the user doesn't own the lock.
 */
export async function releaseLock(params: {
  entityType: string;
  entityId: number;
  modelName: string;
  userId: number;
}): Promise<number> {
  const { entityType, entityId, modelName, userId } = params;

  const modelRes = await resolveModelId(modelName);
  if (modelRes.rows.length === 0) return 0;

  const result = await pool.query(
    `DELETE FROM collab_locks
     WHERE model_id = $1 AND entity_type = $2 AND entity_id = $3 AND user_id = $4`,
    [modelRes.rows[0].id, entityType, entityId, userId]
  );
  return result.rowCount ?? 0;
}

/**
 * Release all locks held by a user (called on disconnect).
 * Returns the list of released locks so callers can broadcast lock:released events.
 */
export async function releaseAllLocksForUser(userId: number): Promise<ReleasedLock[]> {
  const result = await pool.query<{ entity_type: string; entity_id: number; model_name: string }>(
    `DELETE FROM collab_locks cl
     USING stmmodel m
     WHERE cl.model_id = m.id AND cl.user_id = $1
     RETURNING cl.entity_type, cl.entity_id, m.stm_name AS model_name`,
    [userId]
  );
  return result.rows.map((r) => ({
    entityType: r.entity_type,
    entityId: r.entity_id,
    modelName: r.model_name,
  }));
}

/**
 * Verify that a user currently holds a valid (non-expired) lock on an entity.
 */
export async function checkLockOwnership(params: {
  entityType: string;
  entityId: number;
  modelName: string;
  userId: number;
}): Promise<{ owned: boolean; reason?: 'lock_required' | 'lock_expired' | 'not_owner' }> {
  const { entityType, entityId, modelName, userId } = params;

  const modelRes = await resolveModelId(modelName);
  if (modelRes.rows.length === 0) return { owned: false, reason: 'lock_required' };

  const result = await pool.query<{ user_id: number; expires_at: string }>(
    `SELECT user_id, expires_at FROM collab_locks
     WHERE model_id = $1 AND entity_type = $2 AND entity_id = $3`,
    [modelRes.rows[0].id, entityType, entityId]
  );

  if (result.rows.length === 0) return { owned: false, reason: 'lock_required' };

  const lock = result.rows[0];
  if (new Date(lock.expires_at) <= new Date()) return { owned: false, reason: 'lock_expired' };
  if (lock.user_id !== userId) return { owned: false, reason: 'not_owner' };

  return { owned: true };
}

/**
 * Delete all expired locks and return their details for broadcast.
 * Called by the periodic cleanup job.
 */
export async function cleanupExpiredLocks(): Promise<ReleasedLock[]> {
  const result = await pool.query<{ entity_type: string; entity_id: number; model_name: string }>(
    `DELETE FROM collab_locks cl
     USING stmmodel m
     WHERE cl.model_id = m.id AND cl.expires_at < NOW()
     RETURNING cl.entity_type, cl.entity_id, m.stm_name AS model_name`
  );
  return result.rows.map((r) => ({
    entityType: r.entity_type,
    entityId: r.entity_id,
    modelName: r.model_name,
  }));
}
