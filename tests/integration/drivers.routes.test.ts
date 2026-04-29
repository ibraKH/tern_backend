// Mock DB and JWT before any imports so modules initialise with fakes
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

const mockQuery = pool.query as jest.Mock;
const mockVerify = verifyToken as jest.Mock;

// Auth user returned by the auth middleware DB lookup
const AUTH_USER = { id: 1, email: 'editor@test.com', role: 'Editor', contributor_id: null };

/**
 * Build a query mock that dispatches on SQL content.
 * This avoids the Once-queue bleed-through problem that occurs when
 * jest.clearAllMocks() does not flush unconsumed mockResolvedValueOnce values.
 */
function makeQueryMock(overrides: Record<string, { rows: unknown[] }> = {}) {
  return (sql: string) => {
    const s = String(sql);
    // Auth middleware user lookup
    if (s.includes('auth_users')) return Promise.resolve({ rows: [AUTH_USER] });
    // Check each override key against the SQL
    for (const [key, result] of Object.entries(overrides)) {
      if (s.includes(key)) return Promise.resolve(result);
    }
    return Promise.resolve({ rows: [] });
  };
}

beforeEach(() => {
  // mockReset clears both call history AND the Once-queue + any previous implementation.
  // This prevents unconsumed Once values from bleeding into the next test.
  mockQuery.mockReset();
  mockVerify.mockReset();

  mockVerify.mockReturnValue({ uid: 1, email: 'editor@test.com', role: 'Editor' });
  // Default: auth succeeds, everything else returns empty rows
  mockQuery.mockImplementation(makeQueryMock());
});

// ─── GET /drivers/search ──────────────────────────────────────────────────────

describe('GET /drivers/search', () => {
  it('returns 200 with matching drivers', async () => {
    mockQuery.mockImplementation(makeQueryMock({
      ILIKE: { rows: [{ id: 1, name: 'Fire regime', description: 'Altered fire', driver_group: 'Disturbance' }] },
    }));

    const res = await request(app)
      .get('/drivers/search?q=fire')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Fire regime');
  });

  it('returns 200 with empty array when nothing matches', async () => {
    // Default mock already returns empty rows for ILIKE queries
    const res = await request(app)
      .get('/drivers/search?q=zzznomatch')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('respects a custom limit param', async () => {
    const res = await request(app)
      .get('/drivers/search?q=rain&limit=5')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    // Confirm the DB was called with limit=5 as the second param
    const searchCall = mockQuery.mock.calls.find(([sql]: [string]) => String(sql).includes('ILIKE'));
    expect(searchCall).toBeDefined();
    expect(searchCall![1]).toContain(5);
  });

  it('returns 400 when q param is missing', async () => {
    const res = await request(app)
      .get('/drivers/search')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(400);
  });

  it('returns 400 when q exceeds 100 characters', async () => {
    const longQuery = 'a'.repeat(101);
    const res = await request(app)
      .get(`/drivers/search?q=${longQuery}`)
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(400);
  });

  it('returns 400 when limit is out of range', async () => {
    const res = await request(app)
      .get('/drivers/search?q=fire&limit=100')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(400);
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockVerify.mockImplementation(() => { throw new Error('invalid token'); });

    const res = await request(app)
      .get('/drivers/search?q=fire');

    expect(res.status).toBe(401);
  });
});

// ─── GET /drivers/:id/sub-drivers ────────────────────────────────────────────

describe('GET /drivers/:id/sub-drivers', () => {
  it('returns 200 with sub-drivers for a valid driver ID', async () => {
    mockQuery.mockImplementation(makeQueryMock({
      // Parent existence check returns the parent driver
      'SELECT id FROM drivers': { rows: [{ id: 3 }] },
      // Sub-drivers fetch
      'FROM sub_drivers': { rows: [{ id: 10, driver_type: 'direct', driver_description: 'Grazing', management_driver_id: 3 }] },
    }));

    const res = await request(app)
      .get('/drivers/3/sub-drivers')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].management_driver_id).toBe(3);
  });

  it('returns 200 with empty array when driver exists but has no sub-drivers', async () => {
    mockQuery.mockImplementation(makeQueryMock({
      'SELECT id FROM drivers': { rows: [{ id: 7 }] },
      // sub_drivers query falls through to the default empty rows
    }));

    const res = await request(app)
      .get('/drivers/7/sub-drivers')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 404 when driver ID does not exist', async () => {
    // 'SELECT id FROM drivers' returns empty — parent not found
    // (default mock already returns empty rows for unknown SQL)
    const res = await request(app)
      .get('/drivers/999/sub-drivers')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Driver not found');
  });

  it('returns 400 for a non-integer driver ID', async () => {
    const res = await request(app)
      .get('/drivers/abc/sub-drivers')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(400);
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockVerify.mockImplementation(() => { throw new Error('invalid token'); });

    const res = await request(app)
      .get('/drivers/1/sub-drivers');

    expect(res.status).toBe(401);
  });
});
