import pool from "../../config/database";
import { AppError, ConflictError } from "../../errors";

export type EntityType = "node" | "edge" | null;

/** Represents a user mentioned in a comment. */
export interface CommentMention {
  id: number;
  email: string;
}

/** Full comment record with author and mentions. */
export interface CommentRecord {
  id: number;
  modelId: number;
  userId: number;
  entityType: EntityType;
  entityId: number | null;
  body: string;
  resolved: boolean;
  resolvedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorEmail: string;
  mentions: CommentMention[];
}

/** Parameters for creating a new comment. */
export interface CreateCommentParams {
  modelName: string;
  entityType: EntityType;
  entityId?: number | null;
  authorId: number;
  body: string;
}

const EMAIL_MENTION_REGEX = /\@([\w.+-]+@[\w-]+\.[\w.]+)/g;

/** Extracts unique email addresses mentioned in the comment body using regex. */
function extractMentionedEmails(body: string): string[] {
  const emails = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = EMAIL_MENTION_REGEX.exec(body)) !== null) {
    emails.add(match[1].toLowerCase());
  }
  return Array.from(emails);
}

/** Creates a new comment, parses mentions, and inserts into database. */
export async function createComment(params: CreateCommentParams): Promise<CommentRecord> {
  const { modelName, entityType, entityId = null, authorId, body } = params;

  if (!modelName || modelName.trim().length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "modelName must be a non-empty string");
  }

  if (typeof body !== "string" || body.trim().length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "body must be a non-empty string");
  }
  if (body.length > 2000) {
    throw new AppError(400, "VALIDATION_ERROR", "body must be 2000 characters or less");
  }

  if (entityType !== null && entityType !== "node" && entityType !== "edge") {
    throw new AppError(400, "VALIDATION_ERROR", "entityType must be 'node', 'edge' or null");
  }

  try {
    await pool.query("BEGIN");

    const modelRes = await pool.query<{ id: number }>(
      `SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1`,
      [modelName.trim()],
    );

    if (modelRes.rows.length === 0) {
      throw new AppError(404, "NOT_FOUND", "model not found");
    }
    const modelId = modelRes.rows[0].id;

    const authorRes = await pool.query<{ email: string }>(
      `SELECT email FROM auth_users WHERE id = $1 LIMIT 1`,
      [authorId],
    );
    if (authorRes.rows.length === 0) {
      throw new AppError(404, "NOT_FOUND", "author not found");
    }
    const authorEmail = authorRes.rows[0].email;

    const commentRes = await pool.query<{
      id: number;
      entity_type: string | null;
      entity_id: number | null;
      body: string;
      resolved: boolean;
      resolved_at: string | null;
      deleted_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO collab_comments
         (model_id, user_id, entity_type, entity_id, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, entity_type, entity_id, body, resolved, resolved_at, deleted_at, created_at, updated_at`,
      [modelId, authorId, entityType, entityId, body],
    );

    const commentRow = commentRes.rows[0];
    const mentionedEmails = extractMentionedEmails(body);

    let mentions: CommentMention[] = [];
    if (mentionedEmails.length > 0) {
      const { rows: mentionedUsers } = await pool.query<
        { id: number; email: string }
      >(
        `SELECT id, email FROM auth_users WHERE LOWER(email) = ANY($1)`,
        [mentionedEmails.map((e) => e.toLowerCase())],
      );

      for (const user of mentionedUsers) {
        await pool.query(
          `INSERT INTO collab_mentions(comment_id, mentioned_user_id)
           VALUES ($1, $2)
           ON CONFLICT ON CONSTRAINT uq_collab_mentions_pair DO NOTHING`,
          [commentRow.id, user.id],
        );
      }

      mentions = mentionedUsers.map((u) => ({ id: u.id, email: u.email }));
    }

    await pool.query("COMMIT");

    return {
      id: commentRow.id,
      modelId,
      userId: authorId,
      entityType: commentRow.entity_type as EntityType,
      entityId: commentRow.entity_id,
      body: commentRow.body,
      resolved: commentRow.resolved,
      resolvedAt: commentRow.resolved_at,
      deletedAt: commentRow.deleted_at,
      createdAt: commentRow.created_at,
      updatedAt: commentRow.updated_at,
      authorEmail,
      mentions,
    };
  } catch (err: unknown) {
    await pool.query("ROLLBACK");
    if (err instanceof AppError) throw err;
    throw new AppError(500, "DB_ERROR", "Failed to create comment", err);
  }
}

/** Retrieves all non-deleted comments for a model, ordered by creation time. */
export async function getComments(modelName: string): Promise<CommentRecord[]> {
  if (!modelName || modelName.trim().length === 0) return [];

  const modelRes = await pool.query<{ id: number }>(
    `SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1`,
    [modelName.trim()],
  );
  if (modelRes.rows.length === 0) return [];
  const modelId = modelRes.rows[0].id;

  const result = await pool.query<{
    id: number;
    entityType: string | null;
    entityId: number | null;
    body: string;
    resolved: boolean;
    resolvedAt: string | null;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
    authorEmail: string;
    mentions: { id: number; email: string }[] | null;
  }>(
    `SELECT
       c.id,
       c.entity_type AS "entityType",
       c.entity_id AS "entityId",
       c.body,
       c.resolved,
       c.resolved_at AS "resolvedAt",
       c.deleted_at AS "deletedAt",
       c.created_at AS "createdAt",
       c.updated_at AS "updatedAt",
       au.email AS "authorEmail",
       COALESCE(
         json_agg(json_build_object('id', mu.id, 'email', mu.email))
         FILTER (WHERE mu.id IS NOT NULL),
         '[]'
       ) AS "mentions"
     FROM collab_comments c
     JOIN auth_users au ON au.id = c.user_id
     LEFT JOIN collab_mentions m ON m.comment_id = c.id
     LEFT JOIN auth_users mu ON mu.id = m.mentioned_user_id
     WHERE c.model_id = $1 AND c.deleted_at IS NULL
     GROUP BY c.id, au.email
     ORDER BY c.created_at ASC`,
    [modelId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    modelId,
    userId: 0, // not needed by the API consumer
    entityType: row.entityType as EntityType,
    entityId: row.entityId,
    body: row.body,
    resolved: row.resolved,
    resolvedAt: row.resolvedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    authorEmail: row.authorEmail,
    mentions: row.mentions ?? [],
  }));
}

/** Resolves a comment if authorized (author or Admin). */
export async function resolveComment(
  commentId: number,
  requesterId: number,
  requesterRole: "Admin" | "Editor" | "Viewer",
): Promise<void> {
  try {
    await pool.query("BEGIN");

    const { rows } = await pool.query<
      { user_id: number; resolved: boolean; deleted_at: string | null }
    >(
      `SELECT user_id, resolved, deleted_at
       FROM collab_comments
       WHERE id = $1
       LIMIT 1`,
      [commentId],
    );

    if (rows.length === 0) {
      throw new AppError(404, "NOT_FOUND", "comment not found");
    }

    const row = rows[0];
    if (row.deleted_at !== null) {
      throw new AppError(404, "NOT_FOUND", "comment not found");
    }

    if (row.resolved) {
      throw new ConflictError("comment already resolved");
    }

    if (row.user_id !== requesterId && requesterRole !== "Admin") {
      throw new AppError(403, "AUTH_FORBIDDEN", "not authorized to resolve comment");
    }

    await pool.query(
      `UPDATE collab_comments
       SET resolved = TRUE, resolved_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [commentId],
    );

    await pool.query("COMMIT");
  } catch (err: unknown) {
    await pool.query("ROLLBACK");
    if (err instanceof AppError) throw err;
    throw new AppError(500, "DB_ERROR", "Failed to resolve comment", err);
  }
}

/** Soft deletes a comment if authorized (author or Admin). */
export async function deleteComment(
  commentId: number,
  requesterId: number,
  requesterRole: "Admin" | "Editor" | "Viewer",
): Promise<void> {
  try {
    await pool.query("BEGIN");

    const { rows } = await pool.query<
      { user_id: number; deleted_at: string | null }
    >(
      `SELECT user_id, deleted_at
       FROM collab_comments
       WHERE id = $1
       LIMIT 1`,
      [commentId],
    );

    if (rows.length === 0) {
      throw new AppError(404, "NOT_FOUND", "comment not found");
    }

    const row = rows[0];
    if (row.deleted_at !== null) {
      throw new AppError(404, "NOT_FOUND", "comment already deleted");
    }

    if (row.user_id !== requesterId && requesterRole !== "Admin") {
      throw new AppError(403, "AUTH_FORBIDDEN", "not authorized to delete comment");
    }

    await pool.query(
      `UPDATE collab_comments
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [commentId],
    );

    await pool.query("COMMIT");
  } catch (err: unknown) {
    await pool.query("ROLLBACK");
    if (err instanceof AppError) throw err;
    throw new AppError(500, "DB_ERROR", "Failed to delete comment", err);
  }
}
