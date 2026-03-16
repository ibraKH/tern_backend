import pool from '../../config/database';

type EntityType = 'node' | 'edge';

type LockArgs = {
  entityType: EntityType;
  entityId: string;
  modelName: string;
  userId: number;
};

type AcquireLockResult =
  | { success: true }
  | { success: false; heldBy: string | null };

type ReleasedLock = {
  entityType: EntityType;
  entityId: string;
  modelName: string;
};

function validateEntityType(entityType: string): asserts entityType is EntityType {
  if (!['node', 'edge'].includes(entityType)) {
    throw new Error("entityType must be one of ['node', 'edge']");
  }
}

function validateNonEmptyString(value: string, fieldName: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

function validateLockArgs({
  entityType,
  entityId,
  modelName,
}: Omit<LockArgs, 'userId'>): void {
  validateEntityType(entityType);
  validateNonEmptyString(entityId, 'entityId');
  validateNonEmptyString(modelName, 'modelName');
}

export async function acquireLock({
  entityType,
  entityId,
  modelName,
  userId,
}: LockArgs): Promise<AcquireLockResult> {
  validateLockArgs({ entityType, entityId, modelName });

  const client = await pool.connect();

  try {
    const upsertResult = await client.query(
      `INSERT INTO editing_locks (entity_type, entity_id, model_name, user_id, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 seconds')
       ON CONFLICT (entity_type, entity_id, model_name)
       DO UPDATE SET
         user_id = CASE
           WHEN editing_locks.user_id = EXCLUDED.user_id
             OR editing_locks.expires_at <= NOW()
           THEN EXCLUDED.user_id
           ELSE editing_locks.user_id
         END,
         expires_at = CASE
           WHEN editing_locks.user_id = EXCLUDED.user_id
             OR editing_locks.expires_at <= NOW()
           THEN NOW() + INTERVAL '30 seconds'
           ELSE editing_locks.expires_at
         END
       RETURNING user_id, expires_at`,
      [entityType, entityId, modelName, userId]
    );

    const row = upsertResult.rows[0];

    if (row.user_id === userId) {
      return { success: true };
    }

    const holderResult = await client.query(
      `SELECT email
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [row.user_id]
    );

    return {
      success: false,
      heldBy: holderResult.rows[0]?.email ?? null,
    };
  } finally {
    client.release();
  }
}

export async function releaseLock({
  entityType,
  entityId,
  modelName,
  userId,
}: LockArgs): Promise<number> {
  validateLockArgs({ entityType, entityId, modelName });

  const client = await pool.connect();

  try {
    const result = await client.query(
      `DELETE FROM editing_locks
       WHERE entity_type = $1
         AND entity_id = $2
         AND model_name = $3
         AND user_id = $4`,
      [entityType, entityId, modelName, userId]
    );

    return result.rowCount ?? 0;
  } finally {
    client.release();
  }
}

export async function releaseAllLocksForSocket(userId: number): Promise<ReleasedLock[]> {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `DELETE FROM editing_locks
       WHERE user_id = $1
       RETURNING
         entity_type AS "entityType",
         entity_id AS "entityId",
         model_name AS "modelName"`,
      [userId]
    );

    return result.rows as ReleasedLock[];
  } finally {
    client.release();
  }
}

export async function checkLockOwnership({
  entityType,
  entityId,
  modelName,
  userId,
}: LockArgs): Promise<boolean> {
  validateLockArgs({ entityType, entityId, modelName });

  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT 1
       FROM editing_locks
       WHERE entity_type = $1
         AND entity_id = $2
         AND model_name = $3
         AND user_id = $4
         AND expires_at > NOW()`,
      [entityType, entityId, modelName, userId]
    );

    return result.rows.length > 0;
  } finally {
    client.release();
  }
}