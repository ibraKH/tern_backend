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

jest.mock('../../src/services/collab/activity.service', () => ({
  getRecentActivity: jest.fn().mockResolvedValue([]),
  logActivity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/collab/comments.service', () => ({
  getComments: jest.fn().mockResolvedValue({ comments: [], total: 0, limit: 50, offset: 0 }),
  createComment: jest.fn(),
  resolveComment: jest.fn(),
  deleteComment: jest.fn(),
}));

jest.mock('../../src/socket', () => ({
  __esModule: true,
  io: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) },
  initIo: jest.fn(),
  getIo: jest.fn(),
}));

jest.mock('../../src/collab/roomManager', () => ({
  broadcastActivity: jest.fn(),
  joinRoom: jest.fn().mockResolvedValue({}),
  leaveRoom: jest.fn().mockResolvedValue(null),
  getRoom: jest.fn().mockReturnValue(null),
  getUserColor: jest.fn().mockReturnValue('#999'),
}));

import request from 'supertest';

import app from '../../src/app';
import pool from '../../src/config/database';
import { verifyToken } from '../../src/utils/jwt';
import * as commentsService from '../../src/services/collab/comments.service';
import { io } from '../../src/socket';

const mockQuery = pool.query as jest.Mock;
const mockVerify = verifyToken as jest.Mock;

const mockCreateComment = commentsService.createComment as jest.Mock;
const mockResolveComment = commentsService.resolveComment as jest.Mock;
const mockDeleteComment = commentsService.deleteComment as jest.Mock;

const MODEL = 'TestModel';

type Role = 'Admin' | 'Editor' | 'Viewer';

function setupAuth(role: Role = 'Editor', userId = 1, email = 'user@test.com') {
  mockVerify.mockReturnValue({ uid: userId, email, role });
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: userId, email, role, contributor_id: null, is_verified: true }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the io.to mock to return a fresh emit mock on each test
  (io.to as jest.Mock).mockReturnValue({ emit: jest.fn() });
});

// ─── GET /collab/:modelName/activity ─────────────────────────────────────────

describe('GET /collab/:modelName/activity', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(`/collab/${MODEL}/activity`);
    expect(res.status).toBe(401);
  });

  it('returns 200 with {entries:[]} when authenticated', async () => {
    setupAuth('Editor');
    // requireModelRole[ALL] → getModelRole → editor role found → passes
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'editor' }] });

    const res = await request(app)
      .get(`/collab/${MODEL}/activity`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entries: [] });
  });
});

// ─── GET /collab/:modelName/comments ─────────────────────────────────────────

describe('GET /collab/:modelName/comments', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(`/collab/${MODEL}/comments`);
    expect(res.status).toBe(401);
  });

  it('returns 200 with {comments:[]} when authenticated', async () => {
    setupAuth('Editor');
    // requireModelRole[ALL] → getModelRole → editor role found → passes
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'editor' }] });

    const res = await request(app)
      .get(`/collab/${MODEL}/comments`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ comments: [] });
  });
});

// ─── POST /collab/:modelName/comments ────────────────────────────────────────

describe('POST /collab/:modelName/comments', () => {
  it('returns 401 without token', async () => {
    const res = await request(app)
      .post(`/collab/${MODEL}/comments`)
      .send({ body: 'hello' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when body is missing', async () => {
    setupAuth('Editor');
    // requireModelRole[OWNER, EDITOR, REVIEWER] → getModelRole → editor found → passes
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'editor' }] });

    const res = await request(app)
      .post(`/collab/${MODEL}/comments`)
      .set('Authorization', 'Bearer tok')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/body is required/i);
  });

  it('returns 400 when body is too long (> 2000 chars)', async () => {
    setupAuth('Editor');
    // requireModelRole[OWNER, EDITOR, REVIEWER] → getModelRole → editor found → passes
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'editor' }] });

    const res = await request(app)
      .post(`/collab/${MODEL}/comments`)
      .set('Authorization', 'Bearer tok')
      .send({ body: 'x'.repeat(2001) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2000/);
  });

  it('returns 400 when entityType is invalid', async () => {
    setupAuth('Editor');
    // requireModelRole[OWNER, EDITOR, REVIEWER] → getModelRole → editor found → passes
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'editor' }] });

    const res = await request(app)
      .post(`/collab/${MODEL}/comments`)
      .set('Authorization', 'Bearer tok')
      .send({ body: 'valid body', entityType: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/entityType/i);
  });

  it('returns 201 with created comment on happy path', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    // requireModelRole[OWNER, EDITOR, REVIEWER] → getModelRole → editor found → passes
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'editor' }] });

    const fakeComment = {
      id: 10,
      modelName: MODEL,
      entityType: 'node',
      entityId: 5,
      authorId: 1,
      body: 'Great state!',
      parentId: null,
      createdAt: '2026-05-01T12:00:00Z',
      resolvedAt: null,
    };
    mockCreateComment.mockResolvedValueOnce(fakeComment);

    const res = await request(app)
      .post(`/collab/${MODEL}/comments`)
      .set('Authorization', 'Bearer tok')
      .send({ body: 'Great state!', entityType: 'node', entityId: 5 });

    expect(res.status).toBe(201);
    expect(res.body.comment).toMatchObject({ id: 10, body: 'Great state!' });
  });
});

// ─── PATCH /collab/:modelName/comments/:id/resolve ───────────────────────────

describe('PATCH /collab/:modelName/comments/:id/resolve', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).patch(`/collab/${MODEL}/comments/1/resolve`);
    expect(res.status).toBe(401);
  });

  it('returns 200 success:true on happy path', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    // requireModelRole[OWNER, EDITOR, REVIEWER] → getModelRole → editor found → passes
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'editor' }] });
    mockResolveComment.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .patch(`/collab/${MODEL}/comments/10/resolve`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('returns 403 when service throws {status:403}', async () => {
    setupAuth('Viewer', 3, 'viewer@test.com');
    // requireModelRole[OWNER, EDITOR, REVIEWER] → getModelRole returns viewer → 403
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'viewer' }] });
    mockResolveComment.mockRejectedValueOnce({ status: 403, message: 'Forbidden' });

    const res = await request(app)
      .patch(`/collab/${MODEL}/comments/10/resolve`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(403);
  });
});

// ─── DELETE /collab/:modelName/comments/:id ──────────────────────────────────

describe('DELETE /collab/:modelName/comments/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).delete(`/collab/${MODEL}/comments/1`);
    expect(res.status).toBe(401);
  });

  it('returns 200 success:true on happy path', async () => {
    setupAuth('Editor', 1, 'user@test.com');
    // requireModelRole[OWNER, EDITOR, REVIEWER] → getModelRole → editor found → passes
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'editor' }] });
    mockDeleteComment.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .delete(`/collab/${MODEL}/comments/10`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('returns 403 when service throws {status:403}', async () => {
    setupAuth('Viewer', 3, 'viewer@test.com');
    // requireModelRole[OWNER, EDITOR, REVIEWER] → getModelRole returns viewer → 403
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'viewer' }] });
    mockDeleteComment.mockRejectedValueOnce({ status: 403, message: 'Forbidden' });

    const res = await request(app)
      .delete(`/collab/${MODEL}/comments/10`)
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(403);
  });
});
