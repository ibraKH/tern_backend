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
