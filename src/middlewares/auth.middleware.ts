import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";
import pool from "../config/database";
import type { JwtPayload } from "../utils/jwt";

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
    if (!token) return res.status(401).json({ error: "Missing token" });
    const payload = verifyToken(token) as JwtPayload; 

    const { rows } = await pool.query(
      `SELECT id, email, role, contributor_id
         FROM auth_users
        WHERE id = $1`,
      [payload.uid]
    );
    if (rows.length === 0) return res.status(401).json({ error: "User associated with this token does not exist" });

    req.user = {
      id: rows[0].id,
      email: rows[0].email,
      role: rows[0].role,
      contributor_id: rows[0].contributor_id,
    };

    return next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}