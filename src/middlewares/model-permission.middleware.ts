import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getModelRole } from '../services/permissions/model-permissions.service';
import type { ModelRole } from '../types/permissions.types';

interface AuthedRequest extends Request {
  user?: { id: number; email: string; role: string };
}

/**
 * Middleware that enforces per-model role-based access.
 *
 * Resolution order:
 *   1. Global Admin → always allowed (bypasses model_permissions table).
 *   2. Otherwise, look up model_permissions for (stm_name, user_email).
 *      - No record  → 403
 *      - Record exists but role not in `roles` → 403
 *      - Record matches → next()
 *
 * The model name is read from req.params.name first, then req.body.stm_name,
 * so the same middleware works for both /:name routes and POST /save.
 */
export function requireModelRole(roles: ModelRole[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    // Global Admin bypasses all per-model checks.
    if (user.role === 'Admin') {
      return next();
    }

    const stmName: string | undefined =
      (req.params as { name?: string }).name ??
      (req.body as { stm_name?: string } | undefined)?.stm_name;

    if (!stmName) {
      res.status(400).json({ error: 'Model name is required' });
      return;
    }

    const modelRole = await getModelRole(stmName, user.email);

    if (!modelRole) {
      res.status(403).json({ error: 'You do not have access to this model' });
      return;
    }

    if (!roles.includes(modelRole)) {
      res.status(403).json({
        error: `This action requires one of these model roles: ${roles.join(', ')}`,
      });
      return;
    }

    next();
  };
}
