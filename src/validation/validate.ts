import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

interface Schemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

export function validate(schemas: Schemas) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: Record<string, unknown> = {};

    if (schemas.body) {
      const r = schemas.body.safeParse(req.body);
      if (!r.success) errors.body = r.error.format(); else req.body = r.data;
    }
    if (schemas.params) {
      const r = schemas.params.safeParse(req.params);
      if (!r.success) errors.params = r.error.format(); else req.params = r.data as unknown as Record<string, string>;
    }
    if (schemas.query) {
      const r = schemas.query.safeParse(req.query);
      if (!r.success) errors.query = r.error.format(); else req.query = r.data as unknown as Record<string, string>;
    }

    if (Object.keys(errors).length) {
      return res.status(400).json({ message: 'Validation failed', errors });
    }
    next();
  };
}
