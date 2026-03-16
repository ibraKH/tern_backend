jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock('../../src/utils/jwt', () => ({
  __esModule: true,
  verifyToken: jest.fn(),
}));

import request from 'supertest';
import app from '../../src/app';
import pool from '../../src/config/database';
import { verifyToken } from '../../src/utils/jwt';

const AUTH_HEADER = { Authorization: 'Bearer any-token' };
const AUTHED_USER = { id: 1, email: 'admin@example.com', role: 'Admin', contributor_id: null };

beforeEach(() => {
  jest.clearAllMocks();
  (verifyToken as jest.Mock).mockReturnValue({ uid: 1, email: 'admin@example.com', role: 'Admin' });
});

describe('Comments REST API', () => {
  describe('GET /collab/:modelName/comments', () => {
    it('returns 401 without Authorization header', async () => {
      const res = await request(app).get('/collab/Forest/comments');
      expect(res.status).toBe(401);
    });

    it('excludes soft-deleted comments and includes author email', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [AUTHED_USER] }) // requireAuth user fetch
        .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // model lookup
        .mockResolvedValueOnce({
          rows: [
            {
              id: 11,
              entityType: 'node',
              entityId: 42,
              body: 'A comment',
              resolved: false,
              resolvedAt: null,
              deletedAt: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              authorEmail: 'author@example.com',
              mentions: [],
            },
          ],
        });

      const res = await request(app)
        .get('/collab/Forest/comments')
        .set(AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.comments[0].authorEmail).toBe('author@example.com');
      expect(res.body.comments[0].deletedAt).toBeNull();
    });
  });

  describe('POST /collab/:modelName/comments', () => {
    it('returns 400 when body is empty', async () => {
      const res = await request(app)
        .post('/collab/Forest/comments')
        .set(AUTH_HEADER)
        .send({ body: '' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when body is over 2000 chars', async () => {
      const longBody = 'a'.repeat(2001);
      const res = await request(app)
        .post('/collab/Forest/comments')
        .set(AUTH_HEADER)
        .send({ body: longBody });

      expect(res.status).toBe(400);
    });

    it('inserts comment and mention rows for valid emails only', async () => {
      const mentionEmail = 'bob@example.com';

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [AUTHED_USER] }) // requireAuth user fetch
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // model lookup
        .mockResolvedValueOnce({ rows: [{ email: 'admin@example.com' }] }) // author email
        .mockResolvedValueOnce({
          rows: [
            {
              id: 101,
              entity_type: 'node',
              entity_id: 42,
              body: 'hello @' + mentionEmail,
              resolved: false,
              resolved_at: null,
              deleted_at: null,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        }) // insert comment
        .mockResolvedValueOnce({ rows: [{ id: 22, email: mentionEmail }] }) // resolve mentioned user
        .mockResolvedValueOnce({ rows: [] }) // insert mention (no return)
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const res = await request(app)
        .post('/collab/Forest/comments')
        .set(AUTH_HEADER)
        .send({ entityType: 'node', entityId: 42, body: `hello @${mentionEmail} @notfound@example.com` });

      expect(res.status).toBe(201);
      expect(res.body.comment.authorEmail).toBe('admin@example.com');
      expect(res.body.comment.mentions).toEqual([{ id: 22, email: mentionEmail }]);

      // Ensure mention insert includes the resolved user id
      const insertMentionCall = (pool.query as jest.Mock).mock.calls.find((call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO collab_mentions')
      );
      expect(insertMentionCall).toBeDefined();
      expect(insertMentionCall[1]).toEqual([101, 22]);
    });
  });

  describe('PATCH /collab/:modelName/comments/:id/resolve', () => {
    it('resolves comment when requested by author', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [AUTHED_USER] }) // requireAuth
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ user_id: 1, resolved: false, deleted_at: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .patch('/collab/Forest/comments/123/resolve')
        .set(AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('resolves comment when requested by Admin', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [AUTHED_USER] }) // requireAuth
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ user_id: 999, resolved: false, deleted_at: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .patch('/collab/Forest/comments/123/resolve')
        .set(AUTH_HEADER);

      expect(res.status).toBe(200);
    });

    it('returns 409 when comment already resolved', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [AUTHED_USER] }) // requireAuth
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ user_id: 1, resolved: true, deleted_at: null }] });

      const res = await request(app)
        .patch('/collab/Forest/comments/123/resolve')
        .set(AUTH_HEADER);

      expect(res.status).toBe(409);
    });

    it('returns 403 when requested by another Editor', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [AUTHED_USER] }) // requireAuth
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ user_id: 999, resolved: false, deleted_at: null }] });

      // Override auth role to Editor (not Admin)
      (verifyToken as jest.Mock).mockReturnValue({ uid: 1, email: 'admin@example.com', role: 'Editor' });

      const res = await request(app)
        .patch('/collab/Forest/comments/123/resolve')
        .set(AUTH_HEADER);

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /collab/:modelName/comments/:id', () => {
    it('soft deletes comment when requested by author', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [AUTHED_USER] }) // requireAuth
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ user_id: 1, deleted_at: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .delete('/collab/Forest/comments/123')
        .set(AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const updateCall = (pool.query as jest.Mock).mock.calls.find((call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('UPDATE collab_comments')
      );
      expect(updateCall).toBeDefined();
    });

    it('returns 404 when comment already deleted', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [AUTHED_USER] }) // requireAuth
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ user_id: 1, deleted_at: '2026-01-01T00:00:00.000Z' }] });

      const res = await request(app)
        .delete('/collab/Forest/comments/123')
        .set(AUTH_HEADER);

      expect(res.status).toBe(404);
    });
  });
});
