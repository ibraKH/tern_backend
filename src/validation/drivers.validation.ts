import { z } from 'zod';

// Query params for GET /drivers/search
export const searchDriversQuerySchema = z.object({
  q: z.string().min(1, 'search term is required').max(100, 'search term must be at most 100 characters'),
  // Coerce the string query param to a number; defaults to 20 when absent
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

// Route params for GET /drivers/:id/sub-drivers
export const getSubDriversParamsSchema = z.object({
  id: z.coerce.number().int().positive('id must be a positive integer'),
});

export type SearchDriversQuery = z.infer<typeof searchDriversQuerySchema>;
export type GetSubDriversParams = z.infer<typeof getSubDriversParamsSchema>;
