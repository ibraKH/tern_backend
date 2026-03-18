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
const AUTHED_USER = { id: 1, email: 'admin@example.com', role: 'Editor', contributor_id: null };

beforeEach(() => {
  jest.clearAllMocks();
  (verifyToken as jest.Mock).mockReturnValue({ uid: AUTHED_USER.id, email: AUTHED_USER.email, role: AUTHED_USER.role });
});

describe('collab comments API', () => {
  it('returns 401 without Authorization header', async () => {
    const res = await request(app).get('/collab/Forest/comments');
    expect(res.status).toBe(401);
  });

  it('returns 400 when posting empty body', async () => {
    const res = await request(app)
      .post('/collab/Forest/comments')
      .set(AUTH_HEADER)
      .send({ body: '' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when posting body over 2000 chars', async () => {
    const res = await request(app)
      .post('/collab/Forest/comments')
      .set(AUTH_HEADER)
      .send({ body: 'a'.repeat(2001) });

    expect(res.status).toBe(400);
  });

  it('creates comment with mentions and only inserts valid users', async () => {
    (pool.query as jest.Mock)
      // model lookup
      .mockResolvedValueOnce({ rows: [{ id: 123 }] })
      // insert comment
      .mockResolvedValueOnce({ rows: [{ id: 456 }] })
      // lookup mentioned users
      .mockResolvedValueOnce({ rows: [{ id: 222, email: 'alice@example.com' }] })
      // insert mention
      .mockResolvedValueOnce({ rows: [{ id: 999 }] });

    const res = await request(app)
      .post('/collab/Forest/comments')
      .set(AUTH_HEADER)
      .send({ body: 'hi @alice@example.com and @unknown@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.comment).toBeDefined();
    expect(res.body.comment.authorEmail).toBe(AUTHED_USER.email);
    expect(res.body.comment.mentions).toEqual(['alice@example.com']);

    // Ensure we only inserted mention for existing user
    const insertCall = (pool.query as jest.Mock).mock.calls[3];
    expect(insertCall[0]).toContain('INSERT INTO collab_mentions');
  });

  it('gets comments excluding soft-deleted and includes author email', async () => {
    (pool.query as jest.Mock)
      // model lookup
      .mockResolvedValueOnce({ rows: [{ id: 123 }] })
      // fetch comments
      .mockResolvedValueOnce({ rows: [{
        id: 1,
        entity_type: 'node',
        entity_id: 2,
        body: 'hey',
        resolved: false,
        resolved_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        author_id: 1,
        author_email: 'admin@example.com',
      }] });

    const res = await request(app)
      .get('/collab/Forest/comments')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.comments[0].author.email).toBe('admin@example.com');

    const query = (pool.query as jest.Mock).mock.calls[1][0] as string;
    expect(query).toContain('deleted_at IS NULL');
  });

  it('allows author to resolve a comment', async () => {
    (pool.query as jest.Mock)
      // fetch comment for auth
      .mockResolvedValueOnce({ rows: [{ id: 10, user_id: 1, resolved: false, deleted_at: null }] })
      // update resolved
      .mockResolvedValueOnce({ rows: [{ id: 10, resolved: true, resolved_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }] });

    const res = await request(app)
      .patch('/collab/Forest/comments/10/resolve')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.comment.resolved).toBe(true);
  });

  it('allows admin to resolve someone else comment', async () => {
    (verifyToken as jest.Mock).mockReturnValue({ uid: AUTHED_USER.id, email: AUTHED_USER.email, role: 'Admin' });
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 11, user_id: 99, resolved: false, deleted_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 11, resolved: true, resolved_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }] });

    const res = await request(app)
      .patch('/collab/Forest/comments/11/resolve')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.comment.resolved).toBe(true);
  });

  it('returns 403 when non-author non-admin resolves comment', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 12, user_id: 99, resolved: false, deleted_at: null }] });

    const res = await request(app)
      .patch('/collab/Forest/comments/12/resolve')
      .set(AUTH_HEADER);

    expect(res.status).toBe(403);
  });

  it('soft-deletes comment when author deletes', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 15, user_id: 1, deleted_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 15 }] });

    const res = await request(app)
      .delete('/collab/Forest/comments/15')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    const deleteQuery = (pool.query as jest.Mock).mock.calls[1][0] as string;
    expect(deleteQuery).toContain('deleted_at = NOW()');
  });
});
