import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors";

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
    try {
      const user = (req as AuthenticatedRequest).user;

      if (!user) {
        throw new AppError(401, "AUTH_INVALID_CREDENTIALS", "Authentication required");
      }

      if (!allowed.includes(user.role)) {
        throw new AppError(
          403, 
          "AUTH_FORBIDDEN", 
          "Your role is not allowed please contact the admin"
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}