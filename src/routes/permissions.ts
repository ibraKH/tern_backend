import type { Request, Response } from 'express';
import express from 'express';
import { requireRole } from '../middlewares/role.middleware';
import {
  listModelPermissions,
  grantModelRole,
  revokeModelRole,
} from '../services/permissions/model-permissions.service';
import type { ModelRole } from '../types/permissions.types';

type AuthedRequest = Request & { user?: { id: number; email: string; role: string } };

const VALID_ROLES: ModelRole[] = ['viewer', 'editor', 'reviewer'];

const permissions = express.Router({ mergeParams: true });

/**
 * @openapi
 * /models/{name}/permissions:
 *   get:
 *     summary: List all role assignments for a model
 *     description: Returns every model_permissions record for the given model. Admin only.
 *     tags: [Permissions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Array of permission records.
 *       401:
 *         description: Unauthenticated.
 *       403:
 *         description: Forbidden (Admin only).
 *       500:
 *         description: Server error.
 */
permissions.get(
  '/:name/permissions',
  requireRole(['Admin']),
  async (req: Request, res: Response) => {
    try {
      const { name } = req.params as { name: string };
      const list = await listModelPermissions(name);
      res.json(list);
    } catch (error) {
      res.status(500).json({ message: 'Error fetching model permissions', error: String(error) });
    }
  },
);

/**
 * @openapi
 * /models/{name}/permissions/{email}:
 *   put:
 *     summary: Grant or update a per-model role for a user
 *     description: Upserts a (stm_name, user_email, role) record. Admin only.
 *     tags: [Permissions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: email
 *         required: true
 *         schema: { type: string, format: email }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [viewer, editor, reviewer]
 *     responses:
 *       200:
 *         description: Permission granted/updated.
 *       400:
 *         description: Invalid role value.
 *       401:
 *         description: Unauthenticated.
 *       403:
 *         description: Forbidden (Admin only).
 *       500:
 *         description: Server error.
 */
permissions.put(
  '/:name/permissions/:email',
  requireRole(['Admin']),
  async (req: Request, res: Response) => {
    try {
      const { name, email } = req.params as { name: string; email: string };
      const { role } = req.body as { role: ModelRole };

      if (!VALID_ROLES.includes(role)) {
        res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
        return;
      }

      const grantedBy = (req as AuthedRequest).user!.email;
      await grantModelRole(name, email, role, grantedBy);
      res.json({ success: true, stm_name: name, user_email: email, role });
    } catch (error) {
      res.status(500).json({ message: 'Error granting model permission', error: String(error) });
    }
  },
);

/**
 * @openapi
 * /models/{name}/permissions/{email}:
 *   delete:
 *     summary: Revoke a per-model role for a user
 *     description: Removes the model_permissions record for the given user. Admin only.
 *     tags: [Permissions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: email
 *         required: true
 *         schema: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Permission revoked.
 *       401:
 *         description: Unauthenticated.
 *       403:
 *         description: Forbidden (Admin only).
 *       500:
 *         description: Server error.
 */
permissions.delete(
  '/:name/permissions/:email',
  requireRole(['Admin']),
  async (req: Request, res: Response) => {
    try {
      const { name, email } = req.params as { name: string; email: string };
      await revokeModelRole(name, email);
      res.json({ success: true, stm_name: name, user_email: email });
    } catch (error) {
      res.status(500).json({ message: 'Error revoking model permission', error: String(error) });
    }
  },
);

export default permissions;
