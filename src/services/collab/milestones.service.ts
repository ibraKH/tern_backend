import pool from '../../config/database';
import { getModelByName } from '../models/show.service';

export interface MilestoneMetadata {
  id: number;
  label: string;
  createdBy: number;
  createdByEmail: string;
  createdAt: string;
}

export interface MilestoneWithSnapshot extends MilestoneMetadata {
  snapshot: Record<string, unknown>;
}

function resolveModelId(modelName: string) {
  return pool.query<{ id: number }>(
    'SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1',
    [modelName]
  );
}

/**
 * Snapshot the current model state and persist it as a labeled milestone.
 */
export async function createMilestone(params: {
  modelName: string;
  label: string;
  createdBy: number;
}): Promise<MilestoneMetadata> {
  const { modelName, label, createdBy } = params;

  const modelRes = await resolveModelId(modelName);
  if (modelRes.rows.length === 0) throw Object.assign(new Error('Model not found'), { status: 404 });
  const modelId = modelRes.rows[0].id;

  // Fetch the full model as the snapshot payload.
  const model = await getModelByName(modelName);
  if (!model || (!model.states.length && !model.transitions.length)) {
    throw Object.assign(new Error('Cannot create milestone for an empty model'), { status: 422 });
  }

  const result = await pool.query<{ id: number; created_at: string }>(
    `INSERT INTO collab_milestones (model_id, created_by, label, snapshot)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [modelId, createdBy, label, JSON.stringify(model)]
  );

  const authorRes = await pool.query<{ email: string }>(
    'SELECT email FROM auth_users WHERE id = $1',
    [createdBy]
  );

  return {
    id: result.rows[0].id,
    label,
    createdBy,
    createdByEmail: authorRes.rows[0]?.email ?? '',
    createdAt: result.rows[0].created_at,
  };
}

/**
 * List milestones for a model (metadata only, no snapshot).
 */
export async function listMilestones(modelName: string): Promise<MilestoneMetadata[]> {
  const modelRes = await resolveModelId(modelName);
  if (modelRes.rows.length === 0) return [];

  const result = await pool.query<{
    id: number; label: string; created_by: number; email: string; created_at: string;
  }>(
    `SELECT cm.id, cm.label, cm.created_by, au.email, cm.created_at
     FROM collab_milestones cm
     JOIN auth_users au ON au.id = cm.created_by
     WHERE cm.model_id = $1
     ORDER BY cm.created_at DESC`,
    [modelRes.rows[0].id]
  );

  return result.rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdBy: r.created_by,
    createdByEmail: r.email,
    createdAt: r.created_at,
  }));
}

/**
 * Get a single milestone with its snapshot payload.
 * Returns null if not found or doesn't belong to the given model.
 */
export async function getMilestone(id: number, modelName: string): Promise<MilestoneWithSnapshot | null> {
  const modelRes = await resolveModelId(modelName);
  if (modelRes.rows.length === 0) return null;

  const result = await pool.query<{
    id: number; label: string; created_by: number; email: string;
    snapshot: Record<string, unknown>; created_at: string;
  }>(
    `SELECT cm.id, cm.label, cm.created_by, au.email, cm.snapshot, cm.created_at
     FROM collab_milestones cm
     JOIN auth_users au ON au.id = cm.created_by
     WHERE cm.id = $1 AND cm.model_id = $2`,
    [id, modelRes.rows[0].id]
  );

  if (result.rows.length === 0) return null;
  const r = result.rows[0];

  return {
    id: r.id,
    label: r.label,
    createdBy: r.created_by,
    createdByEmail: r.email,
    snapshot: r.snapshot,
    createdAt: r.created_at,
  };
}

/**
 * Hard-delete a milestone. Admin only.
 */
export async function deleteMilestone(
  id: number,
  modelName: string
): Promise<boolean> {
  const modelRes = await resolveModelId(modelName);
  if (modelRes.rows.length === 0) return false;

  const result = await pool.query(
    'DELETE FROM collab_milestones WHERE id = $1 AND model_id = $2',
    [id, modelRes.rows[0].id]
  );
  return (result.rowCount ?? 0) > 0;
}
