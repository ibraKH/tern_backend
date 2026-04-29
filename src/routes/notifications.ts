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

notifications.use(requireAuth);

const markReadSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

/**
 * GET /notifications/mentions
 * Returns unread @mention notifications for the authenticated user.
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
 * PATCH /notifications/mentions/read
 * Body: { ids: number[] } — marks those mentions as read (sets notified_at = NOW()).
 * Returns 204 No Content on success.
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
