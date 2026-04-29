// Mock the DB pool and JWT before any imports so the mocks are in place
// when the Express app and its dependencies are loaded.
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

// Resolves the auth middleware's SELECT query (always returns the requesting user).
const authRow = (email: string, role: string) => ({
  rows: [{ id: 1, email, role, contributor_id: null }],
});

beforeEach(() => jest.clearAllMocks());

// ─── Admin: list permissions ───────────────────────────────────────────────

describe('GET /models/:name/permissions', () => {
  it('returns 403 for non-Admin users', async () => {
    mockVerify.mockReturnValue({ uid: 2, email: 'editor@x.com', role: 'Editor' });
    mockQuery.mockResolvedValueOnce(authRow('editor@x.com', 'Editor'));

    const res = await request(app)
      .get('/models/ModelA/permissions')
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(403);
  });

  it('returns permission list for Admin', async () => {
    mockVerify.mockReturnValue({ uid: 1, email: 'admin@x.com', role: 'Admin' });
    // 1st query: auth middleware user lookup
    mockQuery.mockResolvedValueOnce(authRow('admin@x.com', 'Admin'));
    // 2nd query: listModelPermissions SELECT
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, stm_name: 'ModelA', user_email: 'u@x.com', role: 'viewer', granted_by: 'admin@x.com', granted_at: '2024-01-01' },
      ],
    });

    const res = await request(app)
      .get('/models/ModelA/permissions')
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].user_email).toBe('u@x.com');
  });
});

// ─── Admin: grant permission ───────────────────────────────────────────────

describe('PUT /models/:name/permissions/:email', () => {
  it('returns 400 for invalid role values', async () => {
    mockVerify.mockReturnValue({ uid: 1, email: 'admin@x.com', role: 'Admin' });
    mockQuery.mockResolvedValueOnce(authRow('admin@x.com', 'Admin'));

    const res = await request(app)
      .put('/models/ModelA/permissions/user@x.com')
      .set('Authorization', 'Bearer tok')
      .send({ role: 'superuser' });

    expect(res.status).toBe(400);
  });

  it('returns 403 for non-Admin users', async () => {
    mockVerify.mockReturnValue({ uid: 2, email: 'editor@x.com', role: 'Editor' });
    mockQuery.mockResolvedValueOnce(authRow('editor@x.com', 'Editor'));

    const res = await request(app)
      .put('/models/ModelA/permissions/user@x.com')
      .set('Authorization', 'Bearer tok')
      .send({ role: 'editor' });

    expect(res.status).toBe(403);
  });

  it('grants a role and returns success', async () => {
    mockVerify.mockReturnValue({ uid: 1, email: 'admin@x.com', role: 'Admin' });
    mockQuery.mockResolvedValueOnce(authRow('admin@x.com', 'Admin'));
    // grantModelRole INSERT/UPSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put('/models/ModelA/permissions/user@x.com')
      .set('Authorization', 'Bearer tok')
      .send({ role: 'editor' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, stm_name: 'ModelA', user_email: 'user@x.com', role: 'editor' });
  });
});

// ─── Admin: revoke permission ──────────────────────────────────────────────

describe('DELETE /models/:name/permissions/:email', () => {
  it('returns 403 for non-Admin users', async () => {
    mockVerify.mockReturnValue({ uid: 2, email: 'editor@x.com', role: 'Editor' });
    mockQuery.mockResolvedValueOnce(authRow('editor@x.com', 'Editor'));

    const res = await request(app)
      .delete('/models/ModelA/permissions/user@x.com')
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(403);
  });

  it('revokes a permission and returns success', async () => {
    mockVerify.mockReturnValue({ uid: 1, email: 'admin@x.com', role: 'Admin' });
    mockQuery.mockResolvedValueOnce(authRow('admin@x.com', 'Admin'));
    // revokeModelRole DELETE
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete('/models/ModelA/permissions/user@x.com')
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, stm_name: 'ModelA', user_email: 'user@x.com' });
  });
});

// ─── Per-model enforcement on model read endpoint ─────────────────────────

describe('GET /models/:name — per-model enforcement', () => {
  it('allows a user with viewer role on the model', async () => {
    mockVerify.mockReturnValue({ uid: 3, email: 'viewer@x.com', role: 'Viewer' });
    // auth middleware lookup
    mockQuery.mockResolvedValueOnce(authRow('viewer@x.com', 'Viewer'));
    // requireModelRole → getModelRole
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'viewer' }] });
    // getModelByName queries (return empty to avoid full model hydration)
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/models/ModelA')
      .set('Authorization', 'Bearer tok');

    // 404 is acceptable here (model not in DB); the important thing is NOT 403.
    expect(res.status).not.toBe(403);
  });

  it('blocks a user with no model_permissions record', async () => {
    mockVerify.mockReturnValue({ uid: 4, email: 'nobody@x.com', role: 'Editor' });
    mockQuery.mockResolvedValueOnce(authRow('nobody@x.com', 'Editor'));
    // requireModelRole → getModelRole returns null (no record)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/models/ModelA')
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(403);
  });
});

// ─── Per-model enforcement on save endpoint ───────────────────────────────

describe('POST /models/save — per-model enforcement', () => {
  it('blocks a viewer from saving', async () => {
    mockVerify.mockReturnValue({ uid: 3, email: 'viewer@x.com', role: 'Editor' });
    mockQuery.mockResolvedValueOnce(authRow('viewer@x.com', 'Editor'));
    // requireModelRole → getModelRole returns 'viewer'
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'viewer' }] });

    const res = await request(app)
      .post('/models/save')
      .set('Authorization', 'Bearer tok')
      .send({ stm_name: 'ModelA' });

    expect(res.status).toBe(403);
  });

  it('allows an editor to save', async () => {
    mockVerify.mockReturnValue({ uid: 2, email: 'editor@x.com', role: 'Editor' });
    mockQuery.mockResolvedValueOnce(authRow('editor@x.com', 'Editor'));
    // requireModelRole → getModelRole returns 'editor'
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'editor' }] });
    // saveModel inner queries (minimal mock to reach the 201)
    mockQuery.mockResolvedValue({ rows: [{ id: 42, stm_name: 'ModelA' }] });

    const res = await request(app)
      .post('/models/save')
      .set('Authorization', 'Bearer tok')
      .send({ stm_name: 'ModelA' });

    // 201 or 500 (if saveModel internals fail with mocked data) — not 403.
    expect(res.status).not.toBe(403);
  });

  it('Admin bypasses model permissions and can always save', async () => {
    mockVerify.mockReturnValue({ uid: 1, email: 'admin@x.com', role: 'Admin' });
    mockQuery.mockResolvedValueOnce(authRow('admin@x.com', 'Admin'));
    // No model_permissions query expected for Admin
    mockQuery.mockResolvedValue({ rows: [{ id: 1, stm_name: 'ModelA' }] });

    const res = await request(app)
      .post('/models/save')
      .set('Authorization', 'Bearer tok')
      .send({ stm_name: 'ModelA' });

    expect(res.status).not.toBe(403);
  });
});
