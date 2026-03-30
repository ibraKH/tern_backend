import { z } from 'zod';

export const createCommentSchema = z.object({
  body: z.string().min(1, 'body is required').max(2000, 'body must be 2000 characters or less'),
  entityType: z.union([z.literal('node'), z.literal('edge'), z.null()]).optional(),
  entityId: z.number().int().nullable().optional(),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
