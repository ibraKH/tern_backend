import { RateLimiterMemory } from "rate-limiter-flexible";
import type { Request, Response, NextFunction } from "express";

const signupLimiter = new RateLimiterMemory({
  points: 5,           
  duration: 60 * 10,
  blockDuration: 60 * 30
});

export function limitSignup(req: Request, res: Response, next: NextFunction) {
  const key = req.ip ?? "unknown";
  signupLimiter.consume(key)
    .then(() => next())
    .catch(() =>
      res.status(429).json({ error: "too many signup attempts, please try later" })
    );
}

const loginLimiter = new RateLimiterMemory({ points: 20, duration: 60 * 5 });
export function limitLogin(req: Request, res: Response, next: NextFunction) {
  const key = req.ip ?? "unknown";
  loginLimiter.consume(key)
    .then(() => next())
    .catch(() => res.status(429).json({ error: "too many login attempts" }));
}

const modelsReadLimiter = new RateLimiterMemory({
  points: 100,         
  duration: 60,        
  blockDuration: 60 * 5
});

export function limitModelsRead(req: Request, res: Response, next: NextFunction) {
  interface AuthenticatedRequest extends Request {
    user?: { id: number };
  }
  const user = (req as AuthenticatedRequest).user;
  const key = user?.id?.toString() || req.ip || "unknown";
  modelsReadLimiter.consume(key)
    .then(() => next())
    .catch(() => res.status(429).json({ error: "too many model read requests, please try later" }));
}

const modelsWriteLimiter = new RateLimiterMemory({
  points: 10,          
  duration: 60,        
  blockDuration: 60 * 10 
});

export function limitModelsWrite(req: Request, res: Response, next: NextFunction) {
  interface AuthenticatedRequest extends Request {
    user?: { id: number };
  }
  const user = (req as AuthenticatedRequest).user;
  const key = user?.id?.toString() || req.ip || "unknown";
  modelsWriteLimiter.consume(key)
    .then(() => next())
    .catch(() => res.status(429).json({ error: "too many model write requests, please try later" }));
}
