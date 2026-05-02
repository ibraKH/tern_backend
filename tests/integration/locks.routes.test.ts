// Mocks must be declared before imports.
jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock('../../src/utils/jwt', () => ({
  __esModule: true,
  verifyToken: jest.fn(),
  signToken: jest.fn((p: { uid: number }) => `mock-token-${p.uid}`),
}));

import request from 'supertest';

import app from '../../src/app';
import pool from '../../src/config/database';
import { verifyToken } from '../../src/utils/jwt';

const mockQuery = pool.query as jest.Mock;
const mockVerify = verifyToken as jest.Mock;

const MODEL = 'TestModel';

type Role = 'Admin' | 'Editor' | 'Viewer';

// Sets up verifyToken and the auth middleware's auth_users lookup.
function setupAuth(role: Role = 'Editor', userId = 1, email = 'user@test.com') {
  mockVerify.mockReturnValue({ uid: userId, email, role });
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: userId, email, role, contributor_id: null }],
  });
}

// Mock the review-lock check (getModelLockStatus calls pool.query).
// Returns a not-locked row by default.
function mockReviewLockNotLocked() {
  mockQuery.mockResolvedValueOnce({
    rows: [{ stm_name: MODEL, is_locked: false, locked_by: null, locked_at: null, lock_reason: null }],
  });
}

function mockReviewLockLocked() {
  mockQuery.mockResolvedValueOnce({
    rows: [{ stm_name: MODEL, is_locked: true, locked_by: 'reviewer@test.com', locked_at: '2026-01-01T00:00:00Z', lock_reason: 'Under review' }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── POST /models/:name/lock/acquire ─────────────────────────────────────────

describe('POST /models/:name/lock/acquire', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post(`/models/${MODEL}/lock/acquire`);
    expect(res.status).toBe(401);
  });

  it('returns 403 when model is review-locked', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    mockReviewLockLocked();

    const res = await request(app)
      .post(`/models/${MODEL}/lock/acquire`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/locked for review/i);
  });

  it('returns 404 when model not found', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    mockReviewLockNotLocked();
    // model lookup: not found
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/models/${MODEL}/lock/acquire`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('happy path: acquires new lock (success:true, owner:true)', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    mockReviewLockNotLocked();
    // model lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    // existing lock check: no existing lock
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT returning new lock
    const expiresAt = new Date(Date.now() + 120_000).toISOString();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 99, expires_at: expiresAt }] });

    const res = await request(app)
      .post(`/models/${MODEL}/lock/acquire`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.locked).toBe(true);
    expect(res.body.lockId).toBe('99');
    expect(res.body.owner).toBe(true);
    expect(res.body.lockedBy).toBe('user@test.com');
  });

  it('returns success:false locked:true owner:false when lock held by another user (not expired)', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    mockReviewLockNotLocked();
    // model lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    // existing lock held by user_id=2 (not expired)
    const futureExpiry = new Date(Date.now() + 60_000).toISOString();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 2, expires_at: futureExpiry, email: 'other@test.com' }],
    });

    const res = await request(app)
      .post(`/models/${MODEL}/lock/acquire`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.locked).toBe(true);
    expect(res.body.lockedBy).toBe('other@test.com');
    expect(res.body.owner).toBe(false);
  });
});

// ─── POST /models/:name/lock/renew ───────────────────────────────────────────

describe('POST /models/:name/lock/renew', () => {
  it('returns 401 without token', async () => {
    const res = await request(app)
      .post(`/models/${MODEL}/lock/renew`)
      .send({ lockId: '1' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when lockId is missing', async () => {
    setupAuth('Editor', 1, 'user@test.com');

    const res = await request(app)
      .post(`/models/${MODEL}/lock/renew`)
      .set('Authorization', 'Bearer tok')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lockId/i);
  });

  it('returns 403 when model is review-locked', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    mockReviewLockLocked();

    const res = await request(app)
      .post(`/models/${MODEL}/lock/renew`)
      .set('Authorization', 'Bearer tok')
      .send({ lockId: '55' });

    expect(res.status).toBe(403);
  });

  it('returns 404 when lock not found or not owned by caller', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    mockReviewLockNotLocked();
    // UPDATE returns no rows (lock not found or wrong user)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/models/${MODEL}/lock/renew`)
      .set('Authorization', 'Bearer tok')
      .send({ lockId: '55' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found|not owned/i);
  });

  it('happy path: renews lock successfully', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    mockReviewLockNotLocked();
    const expiresAt = new Date(Date.now() + 120_000).toISOString();
    // UPDATE returning renewed lock
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55, expires_at: expiresAt }] });

    const res = await request(app)
      .post(`/models/${MODEL}/lock/renew`)
      .set('Authorization', 'Bearer tok')
      .send({ lockId: '55' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.locked).toBe(true);
    expect(res.body.lockId).toBe('55');
    expect(res.body.owner).toBe(true);
    expect(res.body.lockedBy).toBe('user@test.com');
  });
});

// ─── POST /models/:name/lock/release ─────────────────────────────────────────

describe('POST /models/:name/lock/release', () => {
  it('returns 401 without token', async () => {
    const res = await request(app)
      .post(`/models/${MODEL}/lock/release`)
      .send({ lockId: '1' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when lockId is missing', async () => {
    setupAuth('Editor', 1, 'user@test.com');

    const res = await request(app)
      .post(`/models/${MODEL}/lock/release`)
      .set('Authorization', 'Bearer tok')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lockId/i);
  });

  it('happy path: releases lock successfully', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    // DELETE query — returns nothing meaningful
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post(`/models/${MODEL}/lock/release`)
      .set('Authorization', 'Bearer tok')
      .send({ lockId: '55' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /models/:name/lock ───────────────────────────────────────────────────

describe('GET /models/:name/lock', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(`/models/${MODEL}/lock`);
    expect(res.status).toBe(401);
  });

  it('returns 404 when model not found', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    // model lookup: not found
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/models/${MODEL}/lock`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns locked:false when no active lock', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    // model lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    // lock check: no active lock
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/models/${MODEL}/lock`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locked: false });
  });

  it('returns locked:true with lock details when lock is active', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    // model lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    // active lock held by user 1 (same as requester => owner:true)
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 1, expires_at: expiresAt, email: 'user@test.com' }],
    });

    const res = await request(app)
      .get(`/models/${MODEL}/lock`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(true);
    expect(res.body.lockId).toBe('55');
    expect(res.body.lockedBy).toBe('user@test.com');
    expect(res.body.owner).toBe(true);
  });
});
