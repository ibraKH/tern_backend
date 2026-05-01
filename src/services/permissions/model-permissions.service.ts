import pool from '../../config/database';
import type { ModelPermission, ModelRole } from '../../types/permissions.types';

/** Returns the model-level role for a user, or null if no record exists.
 *  Template models implicitly grant 'viewer' to every authenticated user. */
export async function getModelRole(
  stmName: string,
  userEmail: string,
): Promise<ModelRole | null> {
  const { rows } = await pool.query<{ role: ModelRole }>(
    'SELECT role FROM model_permissions WHERE stm_name = $1 AND user_email = $2',
    [stmName, userEmail],
  );
  if (rows[0]?.role) return rows[0].role;

  const { rows: templateRows } = await pool.query<{ is_template: boolean }>(
    'SELECT is_template FROM stmmodel WHERE stm_name = $1',
    [stmName],
  );
  if (templateRows[0]?.is_template) return 'viewer';

  return null;
}

/** Lists every permission record for a model (Admin-only view). */
export async function listModelPermissions(
  stmName: string,
): Promise<ModelPermission[]> {
  const { rows } = await pool.query<ModelPermission>(
    `SELECT id, stm_name, user_email, role, granted_by, granted_at
       FROM model_permissions
      WHERE stm_name = $1
      ORDER BY granted_at ASC`,
    [stmName],
  );
  return rows;
}

/**
 * Upserts a role for (stmName, userEmail). Updates role and granted_by when
 * the pair already exists; inserts otherwise.
 */
export async function grantModelRole(
  stmName: string,
  userEmail: string,
  role: ModelRole,
  grantedBy: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO model_permissions (stm_name, user_email, role, granted_by)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (stm_name, user_email)
     DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = now()`,
    [stmName, userEmail, role, grantedBy],
  );
}

/** Removes the permission record for (stmName, userEmail). No-op if absent. */
export async function revokeModelRole(
  stmName: string,
  userEmail: string,
): Promise<void> {
  await pool.query(
    'DELETE FROM model_permissions WHERE stm_name = $1 AND user_email = $2',
    [stmName, userEmail],
  );
}
