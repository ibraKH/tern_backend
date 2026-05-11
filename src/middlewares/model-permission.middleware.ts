import type { Request, Response, NextFunction, RequestHandler } from 'express';
import pool from '../config/database';
import { getModelRole } from '../services/permissions/model-permissions.service';
import type { ModelRole } from '../types/permissions.types';
import { GLOBAL_ROLES, MODEL_ROLES } from '../constants/roles';

interface AuthedRequest extends Request {
  user?: { id: number; email: string; role: string };
}

/**
 * Enforces per-model role-based access.
 *
 * Resolution order:
 *   1. Global Admin → always allowed.
 *   2. Look up model_permissions for (stm_name, user_email).
 *      - If the model does not exist yet (new creation) and the user is an
 *        Editor or Admin → allow. saveModel() inserts the owner row immediately
 *        after, closing the loop. Viewers cannot create models.
 *      - If the model exists but the user has no row → 403.
 *      - 'owner' is normalised to 'editor' for the allowed-roles check, so
 *        requireModelRole(['editor']) passes for both owners and editors.
 *
 * stmName is read from req.params.name, then req.params.modelName (collab routes),
 * then req.body.stm_name (POST /save).
 */
export function requireModelRole(roles: ModelRole[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    if (user.role === GLOBAL_ROLES.ADMIN) {
      return next();
    }

    const params = req.params as { name?: string; modelName?: string };
    const stmName: string | undefined =
      params.name ??
      params.modelName ??
      (req.body as { stm_name?: string } | undefined)?.stm_name;

    if (!stmName) {
      res.status(400).json({ error: 'Model name is required' });
      return;
    }

    const modelRole = await getModelRole(stmName, user.email);

    if (!modelRole) {
      // Distinguish: does the model actually exist?
      const { rows } = await pool.query<{ id: number }>(
        'SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1',
        [stmName]
      );

      if (rows.length === 0) {
        // Bootstrap exception: the model is being created for the first time.
        // Editors and Admins are allowed through; saveModel() will insert the
        // owner row inside the same transaction immediately after.
        if (user.role === GLOBAL_ROLES.EDITOR || user.role === GLOBAL_ROLES.ADMIN) {
          return next();
        }
        // Viewers cannot create models.
        res.status(403).json({ error: 'Viewers cannot create models' });
        return;
      }

      // Model exists but this user has no permission row.
      res.status(403).json({ error: 'You do not have access to this model' });
      return;
    }

    // Normalise 'owner' to 'editor' for the allowed-roles check.
    // An owner always satisfies editor-level requirements.
    const effectiveRole: ModelRole =
      modelRole === MODEL_ROLES.OWNER ? MODEL_ROLES.EDITOR : modelRole;

    if (!roles.includes(effectiveRole) && !roles.includes(modelRole)) {
      res.status(403).json({
        error: `This action requires one of these model roles: ${roles.join(', ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * Allows the model owner or a global Admin to manage a model's permissions.
 * Used on GET/PUT/DELETE /:name/permissions routes.
 */
export const requireModelOwnerOrAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const user = (req as AuthedRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  if (user.role === GLOBAL_ROLES.ADMIN) {
    next();
    return;
  }

  const modelName = req.params.name as string;
  const row = await getModelRole(modelName, user.email);

  if (row === MODEL_ROLES.OWNER) {
    next();
    return;
  }

  res.status(403).json({ message: 'Only the model owner or an Admin can manage permissions' });
};
