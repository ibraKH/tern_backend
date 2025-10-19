import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export function requestId(req: Request, res: Response, next: NextFunction) {
  req.id = (req.headers['x-request-id'] as string) || randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
}
