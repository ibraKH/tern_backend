import type { PoolClient } from 'pg';

import pool from '../../config/database';
import { ForbiddenError } from '../../errors';

type Queryable = Pick<PoolClient, 'query'>;

export interface ModelReviewLockStatus {
  is_locked: boolean;
  locked_by: string | null;
  locked_at: string | null;
  lock_reason: string | null;
}

interface ModelReviewLockRow extends ModelReviewLockStatus {
  stm_name: string;
}

function mapStatus(row: ModelReviewLockRow): ModelReviewLockStatus {
  return {
    is_locked: Boolean(row.is_locked),
    locked_by: row.locked_by ?? null,
    locked_at: row.locked_at ? String(row.locked_at) : null,
    lock_reason: row.lock_reason ?? null,
  };
}

function modelNotFound(stmName: string): { status: number; message: string } {
  return { status: 404, message: `Model with name '${stmName}' not found` };
}

async function findModelLockRowByName(
  stmName: string,
  db: Queryable = pool
): Promise<ModelReviewLockRow | null> {
  const result = await db.query<ModelReviewLockRow>(
    `SELECT stm_name, is_locked, locked_by, locked_at, lock_reason
     FROM stmmodel
     WHERE stm_name = $1
     LIMIT 1`,
    [stmName]
  );
  return result.rows[0] ?? null;
}

async function findModelLockRowById(
  modelId: number,
  db: Queryable = pool
): Promise<ModelReviewLockRow | null> {
  const result = await db.query<ModelReviewLockRow>(
    `SELECT stm_name, is_locked, locked_by, locked_at, lock_reason
     FROM stmmodel
     WHERE id = $1
     LIMIT 1`,
    [modelId]
  );
  return result.rows[0] ?? null;
}

export async function getModelLockStatus(
  stmName: string,
  db: Queryable = pool
): Promise<ModelReviewLockStatus | null> {
  const row = await findModelLockRowByName(stmName, db);
  return row ? mapStatus(row) : null;
}

export async function getRequiredModelLockStatus(
  stmName: string,
  db: Queryable = pool
): Promise<ModelReviewLockStatus> {
  const row = await findModelLockRowByName(stmName, db);
  if (!row) throw modelNotFound(stmName);
  return mapStatus(row);
}

export async function assertModelUnlocked(
  stmName: string,
  db: Queryable = pool
): Promise<void> {
  const status = await getModelLockStatus(stmName, db);
  if (status?.is_locked) {
    throw new ForbiddenError('Model is locked for review');
  }
}

export async function assertModelUnlockedById(
  modelId: number,
  db: Queryable = pool
): Promise<string | null> {
  const row = await findModelLockRowById(modelId, db);
  if (!row) return null;
  if (row.is_locked) {
    throw new ForbiddenError('Model is locked for review');
  }
  return row.stm_name;
}

export async function lockModelForReview(
  stmName: string,
  lockedBy: string,
  reason?: string,
  db: Queryable = pool
): Promise<ModelReviewLockStatus> {
  const trimmedReason = reason?.trim() || null;
  const result = await db.query<ModelReviewLockRow>(
    `UPDATE stmmodel
     SET is_locked = TRUE,
         locked_by = $2,
         locked_at = NOW(),
         lock_reason = $3
     WHERE stm_name = $1
     RETURNING stm_name, is_locked, locked_by, locked_at, lock_reason`,
    [stmName, lockedBy, trimmedReason]
  );

  if (result.rows.length === 0) throw modelNotFound(stmName);
  return mapStatus(result.rows[0]);
}

export async function unlockModelForReview(
  stmName: string,
  db: Queryable = pool
): Promise<ModelReviewLockStatus> {
  const result = await db.query<ModelReviewLockRow>(
    `UPDATE stmmodel
     SET is_locked = FALSE,
         locked_by = NULL,
         locked_at = NULL,
         lock_reason = NULL
     WHERE stm_name = $1
     RETURNING stm_name, is_locked, locked_by, locked_at, lock_reason`,
    [stmName]
  );

  if (result.rows.length === 0) throw modelNotFound(stmName);
  return mapStatus(result.rows[0]);
}
