import pool from '../../config/database';

type EntityType = 'node' | 'edge';

type LockArgs = {
  entityType: EntityType;
  entityId: number | string;
  modelName: string;
  userId: number;
};

type AcquireLockResult =
  | { success: true }
  | { success: false; heldBy: string | null };

type ReleasedLock = {
  entityType: EntityType;
  entityId: number;
  modelName: string;
};

type ModelRow = {
  id: number;
};

type LockOwnerRow = {
  user_id: number;
};

function validateEntityType(entityType: string): asserts entityType is EntityType {
  if (!['node', 'edge'].includes(entityType)) {
    throw new Error("entityType must be one of ['node', 'edge']");
  }
}

function validateModelName(modelName: unknown): asserts modelName is string {
  if (typeof modelName !== 'string' || modelName.trim().length === 0) {
    throw new Error('modelName must be a non-empty string');
  }
}

function validatePositiveInteger(value: unknown, fieldName: string): void {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
}

function parseEntityId(value: number | string): number {
  if (typeof value === 'number') {
    validatePositiveInteger(value, 'entityId');
    return value;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('entityId must be a non-empty string or positive integer');
  }

  const parsed = Number.parseInt(value, 10);
  validatePositiveInteger(parsed, 'entityId');
  return parsed;
}

async function resolveModelId(modelName: string): Promise<number> {
  const normalizedModelName = modelName.trim();
  const result = await pool.query<ModelRow>(
    'SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1',
    [normalizedModelName]
  );

  if (result.rows.length === 0) {
    throw new Error(`Model not found: ${normalizedModelName}`);
  }

  return result.rows[0].id;
}

function validateLockArgs({ entityType, entityId, modelName }: Omit<LockArgs, 'userId'>): { entityId: number; modelName: string } {
  validateEntityType(entityType);
  validateModelName(modelName);

  return {
    entityId: parseEntityId(entityId),
    modelName: modelName.trim(),
  };
}

export async function acquireLock({
  entityType,
  entityId,
  modelName,
  userId,
}: LockArgs): Promise<AcquireLockResult> {
  const validated = validateLockArgs({ entityType, entityId, modelName });
  validatePositiveInteger(userId, 'userId');

  const modelId = await resolveModelId(validated.modelName);

  const upsertResult = await pool.query<LockOwnerRow>(
    `INSERT INTO collab_locks (model_id, entity_type, entity_id, user_id, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 seconds')
     ON CONFLICT (model_id, entity_type, entity_id)
     DO UPDATE SET
       user_id = CASE
         WHEN collab_locks.user_id = EXCLUDED.user_id
           OR collab_locks.expires_at <= NOW()
         THEN EXCLUDED.user_id
         ELSE collab_locks.user_id
       END,
       expires_at = CASE
         WHEN collab_locks.user_id = EXCLUDED.user_id
           OR collab_locks.expires_at <= NOW()
         THEN NOW() + INTERVAL '30 seconds'
         ELSE collab_locks.expires_at
       END
     RETURNING user_id`,
    [modelId, entityType, validated.entityId, userId]
  );

  const row = upsertResult.rows[0];

  if (row.user_id === userId) {
    return { success: true };
  }

  const holderResult = await pool.query<{ email: string }>(
    `SELECT email
     FROM auth_users
     WHERE id = $1
     LIMIT 1`,
    [row.user_id]
  );

  return {
    success: false,
    heldBy: holderResult.rows[0]?.email ?? null,
  };
}

export async function releaseLock({
  entityType,
  entityId,
  modelName,
  userId,
}: LockArgs): Promise<number> {
  const validated = validateLockArgs({ entityType, entityId, modelName });
  validatePositiveInteger(userId, 'userId');

  const modelId = await resolveModelId(validated.modelName);

  const result = await pool.query(
    `DELETE FROM collab_locks
     WHERE model_id = $1
       AND entity_type = $2
       AND entity_id = $3
       AND user_id = $4`,
    [modelId, entityType, validated.entityId, userId]
  );

  return result.rowCount ?? 0;
}

export async function releaseAllLocksForSocket(userId: number): Promise<ReleasedLock[]> {
  validatePositiveInteger(userId, 'userId');

  const result = await pool.query<ReleasedLock>(
    `DELETE FROM collab_locks cl
     USING stmmodel sm
     WHERE cl.user_id = $1
       AND sm.id = cl.model_id
     RETURNING
       cl.entity_type AS "entityType",
       cl.entity_id AS "entityId",
       sm.stm_name AS "modelName"`,
    [userId]
  );

  return result.rows;
}

export async function checkLockOwnership({
  entityType,
  entityId,
  modelName,
  userId,
}: LockArgs): Promise<boolean> {
  const validated = validateLockArgs({ entityType, entityId, modelName });
  validatePositiveInteger(userId, 'userId');

  const modelId = await resolveModelId(validated.modelName);

  const result = await pool.query(
    `SELECT 1
     FROM collab_locks
     WHERE model_id = $1
       AND entity_type = $2
       AND entity_id = $3
       AND user_id = $4
       AND expires_at > NOW()`,
    [modelId, entityType, validated.entityId, userId]
  );

  return result.rows.length > 0;
}