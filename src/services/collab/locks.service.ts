import pool from '../../config/database';

// Supported lockable entity types
type EntityType = 'node' | 'edge';

// Arguments required for lock-related operations
type LockArgs = {
  entityType: EntityType; // Type of entity being locked
  entityId: string;       // Unique ID of the entity
  modelName: string;      // Name of the model the entity belongs to
  userId: number;         // ID of the user performing the operation
};

// Result returned by acquireLock()
// - success: true  => lock acquired successfully
// - success: false => lock is held by another user, optionally with their email
type AcquireLockResult =
  | { success: true }
  | { success: false; heldBy: string | null };

// Shape of lock records returned when releasing all locks for a socket/user
type ReleasedLock = {
  entityType: EntityType;
  entityId: string;
  modelName: string;
};

/**
 * Validates that the given entity type is one of the supported values.
 * Uses a TypeScript assertion so the type is narrowed to EntityType.
 */
function validateEntityType(entityType: string): asserts entityType is EntityType {
  if (!['node', 'edge'].includes(entityType)) {
    throw new Error("entityType must be one of ['node', 'edge']");
  }
}

/**
 * Validates that a string field is not empty or whitespace-only.
 */
function validateNonEmptyString(value: string, fieldName: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

/**
 * Validates the common lock arguments except for userId.
 */
function validateLockArgs({
  entityType,
  entityId,
  modelName,
}: Omit<LockArgs, 'userId'>): void {
  validateEntityType(entityType);
  validateNonEmptyString(entityId, 'entityId');
  validateNonEmptyString(modelName, 'modelName');
}

/**
 * Attempts to acquire a lock for a specific entity.
 *
 * Behavior:
 * 1. If no lock exists, insert a new lock that expires in 30 seconds.
 * 2. If a lock already exists:
 *    - refresh it if it is already owned by the same user
 *    - replace it if the existing lock has expired
 *    - otherwise keep the existing lock unchanged
 *
 * Returns:
 * - { success: true } if the current user owns the lock after the operation
 * - { success: false, heldBy } if another user still holds the lock
 */
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

    // If the resulting lock owner is the current user, the lock was acquired successfully
    if (row.user_id === userId) {
      return { success: true };
    }

    // Otherwise, fetch the email of the current lock holder for display/debugging
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

/**
 * Releases a lock only if it belongs to the given user.
 *
 * Returns the number of deleted rows:
 * - 1 means the lock was successfully released
 * - 0 means no matching lock was found or the user did not own it
 */
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

/**
 * Releases all locks currently held by a given user.
 * This is useful when a socket disconnects and all related locks should be cleaned up.
 *
 * Returns the list of released locks.
 */
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

/**
 * Checks whether the given user currently owns a valid (non-expired) lock
 * for the specified entity.
 *
 * Returns:
 * - true if the user owns the lock and it has not expired
 * - false otherwise
 */
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