import pool from '../../config/database';

export interface MentionNotification {
  id: number;
  commentId: number;
  modelName: string;
  commentText: string;
  authorEmail: string;
  createdAt: string;
}

/**
 * Returns all @mention notifications where notified_at IS NULL for the given user.
 * Joins comments, models, and authors to give the frontend enough context to render a badge.
 */
export async function getPendingMentions(userId: number): Promise<MentionNotification[]> {
  const result = await pool.query<{
    id: number;
    comment_id: number;
    model_name: string;
    comment_text: string;
    author_email: string;
    created_at: string;
  }>(
    `SELECT m.id,
            c.id          AS comment_id,
            s.stm_name    AS model_name,
            c.body        AS comment_text,
            au.email      AS author_email,
            c.created_at
       FROM collab_mentions m
       JOIN collab_comments c  ON c.id  = m.comment_id
       JOIN stmmodel         s  ON s.id  = c.model_id
       JOIN auth_users       au ON au.id = c.user_id
      WHERE m.mentioned_user_id = $1
        AND m.notified_at IS NULL
      ORDER BY c.created_at DESC`,
    [userId]
  );

  return result.rows.map((r) => ({
    id: r.id,
    commentId: r.comment_id,
    modelName: r.model_name,
    commentText: r.comment_text,
    authorEmail: r.author_email,
    createdAt: r.created_at,
  }));
}

/**
 * Stamps notified_at = NOW() on the given mention IDs.
 * The userId guard ensures a user can only mark their own mentions as read.
 */
export async function markMentionsNotified(mentionIds: number[], userId: number): Promise<void> {
  if (mentionIds.length === 0) return;

  await pool.query(
    `UPDATE collab_mentions
        SET notified_at = NOW()
      WHERE id = ANY($1::int[])
        AND mentioned_user_id = $2`,
    [mentionIds, userId]
  );
}
