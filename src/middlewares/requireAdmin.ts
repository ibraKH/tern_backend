import type { Request, Response, NextFunction } from "express";

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: "Admin" | "Editor" | "Viewer";
    contributor_id: number | null;
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthenticatedRequest).user;
  if (!user || user.role !== "Admin") {
    console.warn(`[requireAdmin] 403 – ${user?.email ?? "unauthenticated"} attempted admin access at ${req.method} ${req.path}`);
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
}
