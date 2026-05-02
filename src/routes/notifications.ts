import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.middleware';
import { getPendingMentions, markMentionsNotified } from '../services/collab/mentions.service';
import { validate } from '../validation/validate';

type AuthedRequest = Request & {
  user?: { id: number; email: string; role: string; contributor_id: number | null };
};

const notifications = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Notifications
 *     description: User notification endpoints — @mention alerts
 */

notifications.use(requireAuth);

const markReadSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

/**
 * @openapi
 * /notifications/mentions:
 *   get:
 *     summary: Get unread @mention notifications for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending mention notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mentions:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
notifications.get('/mentions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mentions = await getPendingMentions((req as AuthedRequest).user!.id);
    res.json({ mentions });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /notifications/mentions/read:
 *   patch:
 *     summary: Mark @mention notifications as read
 *     description: Sets `notified_at = NOW()` for the provided mention IDs. Returns 204 No Content on success.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: integer
 *                   minimum: 1
 *     responses:
 *       204:
 *         description: Mentions marked as read — no content
 *       400:
 *         description: Missing or invalid ids array
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
notifications.patch(
  '/mentions/read',
  validate({ body: markReadSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await markMentionsNotified(req.body.ids as number[], (req as AuthedRequest).user!.id);
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  }
);

export default notifications;
