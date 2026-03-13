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

describe('GET /collab/:modelName/activity', () => {
  it('returns 401 without Authorization header', async () => {
    const res = await request(app).get('/collab/Forest/activity');
    expect(res.status).toBe(401);
  });

  it('returns 200 with { entries: [] } when model not found', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [AUTHED_USER] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/collab/NonExistent/activity')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
  });

  it('returns 200 with correct entries shape', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [AUTHED_USER] })
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          action: 'node_added',
          entityType: 'node',
          entityId: 10,
          detail: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          userId: 2,
          userEmail: 'bob@example.com',
        }],
      });

    const res = await request(app)
      .get('/collab/Forest/activity')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.entries[0].action).toBe('node_added');
    expect(res.body.entries[0].user.email).toBe('bob@example.com');
  });

  it('with ?limit=5 passes 5 to service', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [AUTHED_USER] })
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/collab/Forest/activity?limit=5')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect((pool.query as jest.Mock).mock.calls[2][1][1]).toBe(5);
  });

  it('with invalid ?limit falls back to 20', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [AUTHED_USER] })
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/collab/Forest/activity?limit=abc')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect((pool.query as jest.Mock).mock.calls[2][1][1]).toBe(20);
  });

  it('returns 500 when DB throws on activity query', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [AUTHED_USER] })
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })
      .mockRejectedValueOnce(new Error('DB down'));

    const res = await request(app)
      .get('/collab/Forest/activity')
      .set(AUTH_HEADER);

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});
