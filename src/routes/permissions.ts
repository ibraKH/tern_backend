import type { Request, Response } from 'express';
import express from 'express';
import { requireModelOwnerOrAdmin } from '../middlewares/model-permission.middleware';
import { getModelRole } from '../services/permissions/model-permissions.service';
import {
  listModelPermissions,
  grantModelRole,
  revokeModelRole,
} from '../services/permissions/model-permissions.service';
import type { ModelRole } from '../types/permissions.types';
import { MODEL_ROLES } from '../constants/roles';

type AuthedRequest = Request & { user?: { id: number; email: string; role: string } };

const VALID_ROLES: ModelRole[] = [MODEL_ROLES.OWNER, MODEL_ROLES.EDITOR, MODEL_ROLES.REVIEWER, MODEL_ROLES.VIEWER];

const permissions = express.Router({ mergeParams: true });

/**
 * @openapi
 * /models/{name}/permissions:
 *   get:
 *     summary: List all role assignments for a model
 *     description: Returns every model_permissions record for the given model. Model owner or Admin only.
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
 *         description: Forbidden (model owner or Admin only).
 *       500:
 *         description: Server error.
 */
permissions.get(
  '/:name/permissions',
  requireModelOwnerOrAdmin,
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
 *     description: Upserts a (stm_name, user_email, role) record. Model owner or Admin only.
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
 *                 enum: [owner, editor, reviewer, viewer]
 *     responses:
 *       200:
 *         description: Permission granted/updated.
 *       400:
 *         description: Invalid role value.
 *       401:
 *         description: Unauthenticated.
 *       403:
 *         description: Forbidden (model owner or Admin only).
 *       500:
 *         description: Server error.
 */
permissions.put(
  '/:name/permissions/:email',
  requireModelOwnerOrAdmin,
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
 *     description: Removes the model_permissions record for the given user. Model owner or Admin only.
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
 *       400:
 *         description: Owner cannot remove their own owner row.
 *       401:
 *         description: Unauthenticated.
 *       403:
 *         description: Forbidden (model owner or Admin only).
 *       500:
 *         description: Server error.
 */
permissions.delete(
  '/:name/permissions/:email',
  requireModelOwnerOrAdmin,
  async (req: Request, res: Response) => {
    try {
      const { name, email } = req.params as { name: string; email: string };
      const requester = (req as AuthedRequest).user!;

      // An owner cannot remove their own owner row. Admins are exempt.
      if (email === requester.email && requester.role !== 'Admin') {
        const currentRole = await getModelRole(name, requester.email);
        if (currentRole === MODEL_ROLES.OWNER) {
          return res.status(400).json({
            message: 'Cannot remove yourself as owner. Transfer ownership first.',
          });
        }
      }

      await revokeModelRole(name, email);
      res.json({ success: true, stm_name: name, user_email: email });
    } catch (error) {
      res.status(500).json({ message: 'Error revoking model permission', error: String(error) });
    }
  },
);

export default permissions;
