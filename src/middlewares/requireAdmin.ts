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

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthenticatedRequest).user;
  if (!user || user.role !== GLOBAL_ROLES.ADMIN) {
    console.warn(`[requireAdmin] 403 – ${user?.email ?? "unauthenticated"} attempted admin access at ${req.method} ${req.path}`);
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
}
