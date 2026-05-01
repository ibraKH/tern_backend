import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";
import pool from "../config/database";
import type { JwtPayload } from "../utils/jwt";
import { AuthInvalidError, AppError } from "../errors"; 

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: "Admin" | "Editor" | "Viewer";
    contributor_id: number | null;
  };
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const auth = req.header("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    
    if (!token) {
      throw new AuthInvalidError(); 
    }

    const payload = verifyToken(token) as JwtPayload; 

    const { rows } = await pool.query(
      `SELECT id, email, role, contributor_id
         FROM auth_users
        WHERE id = $1`,
      [payload.uid]
    );

    if (rows.length === 0) {
      throw new AuthInvalidError();
    }

    req.user = {
      id: rows[0].id,
      email: rows[0].email,
      role: rows[0].role,
      contributor_id: rows[0].contributor_id,
    };

    next();
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return next(err);
    }
        next(new AuthInvalidError());
  }
}