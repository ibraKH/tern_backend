import type { Request, Response } from "express";
import express from "express";
import { RateLimiterMemory } from "rate-limiter-flexible";
import pool from "../config/database";
import { logAction } from "../utils/auditLog";
import { getConnectedUserCount } from "../collab/roomManager";

const adminRouter = express.Router();

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: "Admin" | "Editor" | "Viewer";
    contributor_id: number | null;
  };
}

const VALID_ROLES = ["Viewer", "Editor", "Admin"] as const;
type Role = (typeof VALID_ROLES)[number];

// 60 req/min per IP
const adminRateLimiter = new RateLimiterMemory({ points: 60, duration: 60 });

adminRouter.use((req: Request, res: Response, next) => {
  const key = req.ip ?? "unknown";
  adminRateLimiter.consume(key)
    .then(() => next())
    .catch(() => res.status(429).json({ error: "Too many requests" }));
});

// --- GET /api/admin/stats ---
adminRouter.get("/stats", async (req: Request, res: Response) => {
  try {
    const [total, verified, unverified] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM auth_users`),
      pool.query(`SELECT COUNT(*)::int AS count FROM auth_users WHERE is_verified = true`),
      pool.query(`SELECT COUNT(*)::int AS count FROM auth_users WHERE is_verified = false`),
    ]);

    res.json({
      totalUsers: total.rows[0].count,
      verifiedUsers: verified.rows[0].count,
      unverifiedUsers: unverified.rows[0].count,
      activeSessions: getConnectedUserCount(),
    });
  } catch (err) {
    console.error("[GET /api/admin/stats]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- GET /api/admin/users ---
adminRouter.get("/users", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const offset = (page - 1) * limit;
    const role = req.query.role as string | undefined;
    const search = req.query.search as string | undefined;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`(u.email ILIKE $${idx} OR c.name ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }
    if (role) {
      if (!VALID_ROLES.includes(role as Role)) {
        return res.status(400).json({ error: "Invalid role filter" });
      }
      conditions.push(`u.role = $${idx}`);
      values.push(role);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM auth_users u
         LEFT JOIN contributors c ON c.id = u.contributor_id
         ${where}`,
      values
    );
    const total: number = countResult.rows[0].count;

    const usersResult = await pool.query(
      `SELECT u.id, c.name, u.email, u.role, u.is_verified, u.created_at
         FROM auth_users u
         LEFT JOIN contributors c ON c.id = u.contributor_id
         ${where}
         ORDER BY u.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    );

    res.json({
      users: usersResult.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("[GET /api/admin/users]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- PATCH /api/admin/users/:id/role ---
adminRouter.patch("/users/:id/role", async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user!;
  const targetId = parseInt(req.params.id);
  if (isNaN(targetId)) return res.status(400).json({ error: "Invalid user id" });

  const { role } = req.body;
  if (!role || !VALID_ROLES.includes(role as Role)) {
    return res.status(400).json({ error: "Invalid role. Must be Viewer, Editor, or Admin" });
  }
  if (targetId === actor.id) {
    return res.status(400).json({ error: "Cannot change your own role" });
  }

  try {
    const result = await pool.query(
      `UPDATE auth_users SET role = $1 WHERE id = $2
       RETURNING id, email, role`,
      [role, targetId]
    );
    if (result.rowCount === 0) {
      console.warn(`[PATCH /api/admin/users/${targetId}/role] 404 – actor ${actor.email}`);
      return res.status(404).json({ error: "User not found" });
    }

    await logAction(pool, {
      actorId: actor.id,
      actorEmail: actor.email,
      action: `Changed role of user ${targetId} to ${role}`,
      targetUserId: targetId,
    });

    res.json({ message: "Role updated", user: result.rows[0] });
  } catch (err) {
    console.error("[PATCH /api/admin/users/:id/role]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- DELETE /api/admin/users/:id/sessions ---
adminRouter.delete("/users/:id/sessions", async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user!;
  const targetId = parseInt(req.params.id);
  if (isNaN(targetId)) return res.status(400).json({ error: "Invalid user id" });

  try {
    const result = await pool.query(
      `DELETE FROM sessions WHERE user_id = $1`,
      [targetId]
    );

    await logAction(pool, {
      actorId: actor.id,
      actorEmail: actor.email,
      action: `Revoked all sessions for user ${targetId}`,
      targetUserId: targetId,
    });

    res.json({ message: "Sessions revoked", count: result.rowCount ?? 0 });
  } catch (err) {
    console.error("[DELETE /api/admin/users/:id/sessions]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- DELETE /api/admin/users/:id ---
adminRouter.delete("/users/:id", async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user!;
  const targetId = parseInt(req.params.id);
  if (isNaN(targetId)) return res.status(400).json({ error: "Invalid user id" });

  if (targetId === actor.id) {
    return res.status(400).json({ error: "Cannot delete your own account" });
  }

  try {
    const lookup = await pool.query(
      `SELECT email FROM auth_users WHERE id = $1`,
      [targetId]
    );
    if (lookup.rowCount === 0) {
      console.warn(`[DELETE /api/admin/users/${targetId}] 404 – actor ${actor.email}`);
      return res.status(404).json({ error: "User not found" });
    }
    const targetEmail: string = lookup.rows[0].email;

    await pool.query(`DELETE FROM auth_users WHERE id = $1`, [targetId]);

    await logAction(pool, {
      actorId: actor.id,
      actorEmail: actor.email,
      action: `Deleted user ${targetEmail} (id: ${targetId})`,
      targetUserId: targetId,
      metadata: { deletedEmail: targetEmail },
    });

    res.json({ message: "User deleted" });
  } catch (err) {
    console.error("[DELETE /api/admin/users/:id]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- GET /api/admin/audit-log ---
adminRouter.get("/audit-log", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT al.*, u.email AS actor_email_current
         FROM audit_log al
         LEFT JOIN auth_users u ON al.actor_id = u.id
         ORDER BY al.created_at DESC
         LIMIT 20`
    );
    res.json({ logs: result.rows });
  } catch (err) {
    console.error("[GET /api/admin/audit-log]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default adminRouter;
