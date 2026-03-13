import pool from '../../config/database';

export interface LogActivityParams {
  modelName: string;
  userId: number;
  action: string;
  entityType?: string;
  entityId?: number;
  detail?: Record<string, unknown>;
}

export interface ActivityEntry {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
  user: { id: number; email: string };
}

interface ModelRow {
  id: number;
}

interface ActivityRow {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
  userId: number;
  userEmail: string;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    const { modelName, userId, action, entityType, entityId, detail } = params;

    const modelResult = await pool.query<ModelRow>(
      'SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1',
      [modelName]
    );

    if (modelResult.rows.length === 0) {
      console.warn(`[activity] model not found: ${modelName}`);
      return;
    }

    const modelId: number = modelResult.rows[0].id;

    await pool.query(
      `INSERT INTO collab_activity (model_id, user_id, action, entity_type, entity_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [modelId, userId, action, entityType, entityId, detail]
    );
  } catch (err) {
    console.error('[activity] logActivity failed:', err);
  }
}

export async function getRecentActivity(
  modelName: string,
  limit?: number
): Promise<ActivityEntry[]> {
  let clampedLimit = 20;
  if (limit !== undefined) {
    if (!Number.isNaN(limit) && Number.isFinite(limit) && limit > 0) {
      clampedLimit = Math.min(limit, 100);
    }
  }

  const modelResult = await pool.query<ModelRow>(
    'SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1',
    [modelName]
  );

  if (modelResult.rows.length === 0) {
    return [];
  }

  const modelId: number = modelResult.rows[0].id;

  const result = await pool.query<ActivityRow>(
    `SELECT
       ca.id,
       ca.action,
       ca.entity_type    AS "entityType",
       ca.entity_id      AS "entityId",
       ca.detail,
       ca.created_at     AS "createdAt",
       au.id             AS "userId",
       au.email          AS "userEmail"
     FROM collab_activity ca
     JOIN auth_users au ON au.id = ca.user_id
     WHERE ca.model_id = $1
     ORDER BY ca.created_at DESC
     LIMIT $2`,
    [modelId, clampedLimit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    detail: row.detail,
    createdAt: row.createdAt,
    user: { id: row.userId, email: row.userEmail },
  }));
}
