import pool from '../../config/database';
import { AppError, ConflictError, ValidationError } from '../../errors';

export type CommentEntityType = 'node' | 'edge' | null;

export interface CommentResult {
  id: number;
  modelId: number;
  authorId: number;
  authorEmail: string;
  entityType: CommentEntityType;
  entityId: number | null;
  body: string;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  mentions: string[];
}

const EMAIL_MENTION_REGEX = /\@([\w.+-]+@[\w-]+\.[\w.]+)/g;

export interface CreateCommentParams {
  modelName: string;
  entityType: CommentEntityType;
  entityId: number | null;
  authorId: number;
  authorEmail: string;
  body: string;
}

export async function createComment(params: CreateCommentParams): Promise<CommentResult> {
  const { modelName, entityType, entityId, authorId, authorEmail, body } = params;

  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    throw new ValidationError([{ section: 'body', path: 'body', message: 'body must be a non-empty string', code: 'too_small' }]);
  }
  if (body.length > 2000) {
    throw new ValidationError([{ section: 'body', path: 'body', message: 'body must be 2000 characters or less', code: 'too_big' }]);
  }

  if (entityType !== null && entityType !== 'node' && entityType !== 'edge') {
    throw new ValidationError([{ section: 'body', path: 'entityType', message: "entityType must be 'node', 'edge', or null", code: 'invalid_type' }]);
  }

  const client = await pool.connect();
  try {
    // Resolve model id
    const modelRes = await client.query<{ id: number }>(
      'SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1',
      [modelName]
    );
    if (modelRes.rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', `model not found: ${modelName}`);
    }
    const modelId = modelRes.rows[0].id;

    const insertRes = await client.query<{
      id: number;
      model_id: number;
      user_id: number;
      entity_type: string | null;
      entity_id: number | null;
      body: string;
      resolved: boolean;
      resolved_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO collab_comments
         (model_id, user_id, entity_type, entity_id, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, model_id, user_id, entity_type, entity_id, body, resolved, resolved_at, created_at, updated_at`,
      [modelId, authorId, entityType, entityId, body]
    );

    const commentRow = insertRes.rows[0];

    // Parse @mentions and insert into collab_mentions (skip unknown emails)
    const mentionedEmails = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = EMAIL_MENTION_REGEX.exec(body)) !== null) {
      if (match[1]) {
        mentionedEmails.add(match[1].toLowerCase());
      }
    }

    const mentions: string[] = [];
    if (mentionedEmails.size) {
      const emails = Array.from(mentionedEmails);
      const usersRes = await client.query<{ id: number; email: string }>(
        `SELECT id, email FROM auth_users WHERE LOWER(email) = ANY($1)`,
        [emails]
      );

      for (const u of usersRes.rows) {
        mentions.push(u.email);
        await client.query(
          `INSERT INTO collab_mentions (comment_id, mentioned_user_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
          [commentRow.id, u.id]
        );
      }
    }

    return {
      id: commentRow.id,
      modelId: commentRow.model_id,
      authorId: commentRow.user_id,
      authorEmail,
      entityType: commentRow.entity_type as CommentEntityType,
      entityId: commentRow.entity_id,
      body: commentRow.body,
      resolved: commentRow.resolved,
      resolvedAt: commentRow.resolved_at,
      createdAt: commentRow.created_at,
      updatedAt: commentRow.updated_at,
      mentions,
    };
  } finally {
    client.release();
  }
}

export async function getComments(modelName: string) {
  const modelRes = await pool.query<{ id: number }>(
    'SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1',
    [modelName]
  );
  if (modelRes.rows.length === 0) return [];

  const modelId = modelRes.rows[0].id;

  const result = await pool.query<{
    id: number;
    entity_type: string | null;
    entity_id: number | null;
    body: string;
    resolved: boolean;
    resolved_at: string | null;
    created_at: string;
    updated_at: string;
    author_id: number;
    author_email: string;
  }>(
    `SELECT
       cc.id,
       cc.entity_type,
       cc.entity_id,
       cc.body,
       cc.resolved,
       cc.resolved_at,
       cc.created_at,
       cc.updated_at,
       au.id AS author_id,
       au.email AS author_email
     FROM collab_comments cc
     JOIN auth_users au ON au.id = cc.user_id
     WHERE cc.model_id = $1
       AND cc.deleted_at IS NULL
     ORDER BY cc.created_at ASC`,
    [modelId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    entityType: row.entity_type as CommentEntityType,
    entityId: row.entity_id,
    body: row.body,
    resolved: row.resolved,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: {
      id: row.author_id,
      email: row.author_email,
    },
  }));
}

export async function resolveComment(
  commentId: number,
  requesterId: number,
  requesterRole: 'Admin' | 'Editor' | 'Viewer'
) {
  const { rows } = await pool.query<{
    id: number;
    user_id: number;
    resolved: boolean;
    deleted_at: string | null;
  }>(
    `SELECT id, user_id, resolved, deleted_at
       FROM collab_comments
       WHERE id = $1`,
    [commentId]
  );

  if (rows.length === 0 || rows[0].deleted_at !== null) {
    throw new AppError(404, 'NOT_FOUND', 'comment not found');
  }

  const comment = rows[0];
  if (comment.resolved) {
    throw new ConflictError('comment already resolved');
  }

  if (comment.user_id !== requesterId && requesterRole !== 'Admin') {
    throw new AppError(403, 'AUTH_FORBIDDEN', 'not authorized to resolve this comment');
  }

  const res = await pool.query<{
    id: number;
    resolved: boolean;
    resolved_at: string | null;
    updated_at: string;
  }>(
    `UPDATE collab_comments
       SET resolved = true,
           resolved_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, resolved, resolved_at, updated_at`,
    [commentId]
  );

  return res.rows[0];
}

export async function deleteComment(
  commentId: number,
  requesterId: number,
  requesterRole: 'Admin' | 'Editor' | 'Viewer'
) {
  const { rows } = await pool.query<{
    id: number;
    user_id: number;
    deleted_at: string | null;
  }>(
    `SELECT id, user_id, deleted_at
       FROM collab_comments
       WHERE id = $1`,
    [commentId]
  );

  if (rows.length === 0 || rows[0].deleted_at !== null) {
    throw new AppError(404, 'NOT_FOUND', 'comment not found');
  }

  const comment = rows[0];
  if (comment.user_id !== requesterId && requesterRole !== 'Admin') {
    throw new AppError(403, 'AUTH_FORBIDDEN', 'not authorized to delete this comment');
  }

  await pool.query(
    `UPDATE collab_comments
       SET deleted_at = NOW()
       WHERE id = $1`,
    [commentId]
  );

  return { id: commentId };
}
