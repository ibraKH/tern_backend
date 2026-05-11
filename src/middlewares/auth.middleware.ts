import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";
import pool from "../config/database";
import type { JwtPayload } from "../utils/jwt";
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

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const auth = req.header("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const payload = verifyToken(token) as JwtPayload;

    const { rows } = await pool.query(
      `SELECT id, email, role, contributor_id, is_verified
         FROM auth_users
        WHERE id = $1`,
      [payload.uid]
    );
    if (rows.length === 0) return res.status(401).json({ error: "User associated with this token does not exist" });

    if (!rows[0].is_verified) {
      return res.status(401).json({ code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email address' });
    }

    req.user = {
      id: rows[0].id,
      email: rows[0].email,
      role: rows[0].role as GlobalRole,
      contributor_id: rows[0].contributor_id,
    };

    return next();
  } catch (err: unknown) {
    res.status(401).json({ error: "Cannot authenticate user", details: (err as Error).message || err });
  }
}

export { GLOBAL_ROLES };
