import type { Pool } from "pg";

interface LogActionParams {
  actorId: number | null;
  actorEmail: string;
  action: string;
  targetUserId?: number | null;
  metadata?: Record<string, unknown> | null;
}

export async function logAction(pool: Pool, params: LogActionParams): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_email, action, target_user_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.actorId,
        params.actorEmail,
        params.action,
        params.targetUserId ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null,
      ]
    );
  } catch (err) {
    console.error("[auditLog] failed to write audit entry:", (err as Error).message);
  }
}
