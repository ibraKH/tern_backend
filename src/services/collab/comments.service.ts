import pool from '../../config/database';

export interface CreateCommentParams {
  modelName: string;
  entityType?: string | null;
  entityId?: number | null;
  authorId: number;
  body: string;
  parentId?: number | null;
}

export interface CommentEntry {
  id: number;
  entityType: string | null;
  entityId: number | null;
  parentId: number | null;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  author: { id: number; email: string };
  mentions: string[];
}

const EMAIL_MENTION_RE = /@([\w.+-]+@[\w-]+\.[\w.]+)/g;

function resolveModelId(modelName: string) {
  return pool.query<{ id: number }>(
    'SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1',
    [modelName]
  );
}

/**
 * Create a comment and persist any @email mentions found in the body.
 */
export async function createComment(params: CreateCommentParams): Promise<CommentEntry> {
  const { modelName, entityType, entityId, authorId, body, parentId } = params;

  const modelRes = await resolveModelId(modelName);
  if (modelRes.rows.length === 0) throw Object.assign(new Error('Model not found'), { status: 404 });
  const modelId = modelRes.rows[0].id;

  const commentRes = await pool.query<{
    id: number; entity_type: string | null; entity_id: number | null;
    parent_id: number | null; body: string; resolved: boolean;
    created_at: string; updated_at: string;
  }>(
    `INSERT INTO collab_comments (model_id, user_id, entity_type, entity_id, parent_id, body)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, entity_type, entity_id, parent_id, body, resolved, created_at, updated_at`,
    [modelId, authorId, entityType ?? null, entityId ?? null, parentId ?? null, body]
  );
  const row = commentRes.rows[0];

  // Resolve author email.
  const authorRes = await pool.query<{ email: string }>(
    'SELECT email FROM auth_users WHERE id = $1',
    [authorId]
  );

  // Parse @mentions from body and insert into collab_mentions.
  const mentions: string[] = [];
  const emailMatches = [...body.matchAll(EMAIL_MENTION_RE)].map((m) => m[1]);
  for (const email of [...new Set(emailMatches)]) {
    const userRes = await pool.query<{ id: number }>(
      'SELECT id FROM auth_users WHERE email = $1',
      [email]
    );
    if (userRes.rows.length > 0) {
      await pool.query(
        `INSERT INTO collab_mentions (comment_id, mentioned_user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [row.id, userRes.rows[0].id]
      );
      mentions.push(email);
    }
  }

  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    parentId: row.parent_id,
    body: row.body,
    resolved: row.resolved,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: { id: authorId, email: authorRes.rows[0]?.email ?? '' },
    mentions,
  };
}

/**
 * List all non-deleted comments for a model, ordered by creation time ASC.
 */
export async function getComments(modelName: string): Promise<CommentEntry[]> {
  const modelRes = await resolveModelId(modelName);
  if (modelRes.rows.length === 0) return [];
  const modelId = modelRes.rows[0].id;

  const result = await pool.query<{
    id: number; entity_type: string | null; entity_id: number | null;
    parent_id: number | null; body: string; resolved: boolean;
    created_at: string; updated_at: string; user_id: number; email: string;
  }>(
    `SELECT cc.id, cc.entity_type, cc.entity_id, cc.parent_id, cc.body,
            cc.resolved, cc.created_at, cc.updated_at, cc.user_id, au.email
     FROM collab_comments cc
     JOIN auth_users au ON au.id = cc.user_id
     WHERE cc.model_id = $1
     ORDER BY cc.created_at ASC`,
    [modelId]
  );

  return result.rows.map((r) => ({
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    parentId: r.parent_id,
    body: r.body,
    resolved: r.resolved,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    author: { id: r.user_id, email: r.email },
    mentions: [],
  }));
}

/**
 * Mark a comment as resolved. Only the author or an Admin can resolve.
 */
export async function resolveComment(
  commentId: number,
  requesterId: number,
  requesterRole: string
): Promise<void> {
  const comment = await pool.query<{ user_id: number; resolved: boolean }>(
    'SELECT user_id, resolved FROM collab_comments WHERE id = $1',
    [commentId]
  );
  if (comment.rows.length === 0) throw Object.assign(new Error('Comment not found'), { status: 404 });
  if (comment.rows[0].resolved) throw Object.assign(new Error('Already resolved'), { status: 409 });
  if (comment.rows[0].user_id !== requesterId && requesterRole !== 'Admin') {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }

  await pool.query('UPDATE collab_comments SET resolved = true, updated_at = NOW() WHERE id = $1', [commentId]);
}

/**
 * Soft-delete a comment. Only the author or an Admin can delete.
 */
export async function deleteComment(
  commentId: number,
  requesterId: number,
  requesterRole: string
): Promise<void> {
  const comment = await pool.query<{ user_id: number; body: string }>(
    'SELECT user_id, body FROM collab_comments WHERE id = $1',
    [commentId]
  );
  if (comment.rows.length === 0) throw Object.assign(new Error('Comment not found'), { status: 404 });
  if (comment.rows[0].user_id !== requesterId && requesterRole !== 'Admin') {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }

  // Soft-delete by setting body to empty and marking resolved.
  await pool.query(
    `DELETE FROM collab_comments WHERE id = $1`,
    [commentId]
  );
}
