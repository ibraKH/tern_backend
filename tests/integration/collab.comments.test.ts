jest.mock('../../src/config/database', () => {
  const mockQuery = jest.fn();
  const mockClient = {
    query: mockQuery,
    release: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      query: mockQuery,
      connect: jest.fn().mockResolvedValue(mockClient),
    },
  };
});

jest.mock('../../src/utils/jwt', () => ({
  __esModule: true,
  verifyToken: jest.fn(),
}));

jest.mock('../../src/socket', () => ({
  getIo: jest.fn(() => ({
    to: jest.fn().mockReturnValue({
      emit: jest.fn(),
    }),
  })),
}));

jest.mock('../../src/collab/roomManager', () => ({
  getSocketIdsByUserId: jest.fn(() => []),
}));

import request from 'supertest';
import app from '../../src/app';
import pool from '../../src/config/database';
import { verifyToken } from '../../src/utils/jwt';

const AUTH_HEADER = { Authorization: 'Bearer any-token' };
const AUTHED_USER = { id: 1, email: 'admin@example.com', role: 'Editor', contributor_id: null };

beforeEach(() => {
  jest.clearAllMocks();
  (verifyToken as jest.Mock).mockReturnValue({
    uid: AUTHED_USER.id,
    email: AUTHED_USER.email,
    role: AUTHED_USER.role,
  });

  (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
});

describe('collab comments API', () => {
  it('returns 401 without Authorization header', async () => {
    const res = await request(app).get('/collab/Forest/comments');
    expect(res.status).toBe(401);
  });

  it('returns 400 when posting empty body', async () => {
    (pool.query as jest.Mock)
      // auth middleware
      .mockResolvedValueOnce({ rows: [AUTHED_USER] });

    const res = await request(app)
      .post('/collab/Forest/comments')
      .set(AUTH_HEADER)
      .send({ body: '' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when posting body over 2000 chars', async () => {
    (pool.query as jest.Mock)
      // auth middleware
      .mockResolvedValueOnce({ rows: [AUTHED_USER] });

    const res = await request(app)
      .post('/collab/Forest/comments')
      .set(AUTH_HEADER)
      .send({ body: 'a'.repeat(2001) });

    expect(res.status).toBe(400);
  });

  it('creates comment with mentions and only inserts valid users', async () => {
    (pool.query as jest.Mock)
      // auth middleware
      .mockResolvedValueOnce({ rows: [AUTHED_USER] })
      // model lookup
      .mockResolvedValueOnce({ rows: [{ id: 123 }] })
      // insert comment (RETURNING all fields)
      .mockResolvedValueOnce({ rows: [{
        id: 456,
        model_id: 123,
        user_id: 1,
        entity_type: null,
        entity_id: null,
        body: 'hi @alice@example.com and @unknown@example.com',
        resolved: false,
        resolved_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }] })
      // lookup mentioned users
      .mockResolvedValueOnce({ rows: [{ id: 222, email: 'alice@example.com' }] })
      // insert mention
      .mockResolvedValueOnce({ rows: [{ id: 999 }] })
      // logActivity model lookup
      .mockResolvedValueOnce({ rows: [{ id: 123 }] })
      // logActivity insert
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      // mention notification: lookup mentioned user
      .mockResolvedValueOnce({ rows: [{ id: 222 }] });

    const res = await request(app)
      .post('/collab/Forest/comments')
      .set(AUTH_HEADER)
      .send({ body: 'hi @alice@example.com and @unknown@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.comment).toBeDefined();
    expect(res.body.comment.authorEmail).toBe(AUTHED_USER.email);
    expect(res.body.comment.mentions).toEqual(['alice@example.com']);

    // Ensure we only inserted mention for existing user
    const insertCall = (pool.query as jest.Mock).mock.calls[4];
    expect(insertCall[0]).toContain('INSERT INTO collab_mentions');
  });

  it('gets comments excluding soft-deleted and includes author email', async () => {
    (pool.query as jest.Mock)
      // auth middleware
      .mockResolvedValueOnce({ rows: [AUTHED_USER] })
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

    const query = (pool.query as jest.Mock).mock.calls[2][0] as string;
    expect(query).toContain('deleted_at IS NULL');
  });

  it('allows author to resolve a comment', async () => {
    (pool.query as jest.Mock)
      // auth middleware
      .mockResolvedValueOnce({ rows: [AUTHED_USER] })
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
      // auth middleware
      .mockResolvedValueOnce({ rows: [{ ...AUTHED_USER, role: 'Admin' }] })
      // fetch comment for auth
      .mockResolvedValueOnce({ rows: [{ id: 11, user_id: 99, resolved: false, deleted_at: null }] })
      // update resolved
      .mockResolvedValueOnce({ rows: [{ id: 11, resolved: true, resolved_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }] });

    const res = await request(app)
      .patch('/collab/Forest/comments/11/resolve')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.comment.resolved).toBe(true);
  });

  it('returns 403 when non-author non-admin resolves comment', async () => {
    (pool.query as jest.Mock)
      // auth middleware
      .mockResolvedValueOnce({ rows: [AUTHED_USER] })
      // fetch comment for auth
      .mockResolvedValueOnce({ rows: [{ id: 12, user_id: 99, resolved: false, deleted_at: null }] });

    const res = await request(app)
      .patch('/collab/Forest/comments/12/resolve')
      .set(AUTH_HEADER);

    expect(res.status).toBe(403);
  });

  it('soft-deletes comment when author deletes', async () => {
    (pool.query as jest.Mock)
      // auth middleware
      .mockResolvedValueOnce({ rows: [AUTHED_USER] })
      // fetch comment for auth
      .mockResolvedValueOnce({ rows: [{ id: 15, user_id: 1, deleted_at: null }] })
      // soft-delete
      .mockResolvedValueOnce({ rows: [{ id: 15 }] });

    const res = await request(app)
      .delete('/collab/Forest/comments/15')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    const deleteQuery = (pool.query as jest.Mock).mock.calls[2][0] as string;
    expect(deleteQuery).toContain('deleted_at = NOW()');
  });
});
