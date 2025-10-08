import type { Request, Response, NextFunction } from "express";

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: "Admin" | "Editor" | "Viewer";
    contributor_id: number | null;
  };
}

export function requireRole(allowed: Array<"Admin" | "Editor" | "Viewer">) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return res.status(401).json({ error: "Unauthenticated" });
    if (!allowed.includes(user.role)) return res.status(403).json({ error: "Your role is not allowed please contact the admin" });
    next();
  };
}
