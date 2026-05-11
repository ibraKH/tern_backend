import type { Request, Response, NextFunction } from "express";
import { GLOBAL_ROLES } from "../constants/roles";
import type { GlobalRole } from "../constants/roles";

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: GlobalRole;
    contributor_id: number | null;
  };
}

export function requireRole(allowed: GlobalRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return res.status(401).json({ error: "Unauthenticated" });
    if (!allowed.includes(user.role as GlobalRole))
      return res.status(403).json({ error: "Your role is not allowed please contact the admin" });
    next();
  };
}

export { GLOBAL_ROLES };
