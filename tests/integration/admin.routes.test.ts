jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock('../../src/utils/jwt', () => ({
  __esModule: true,
  verifyToken: jest.fn(),
}));

jest.mock('../../src/middlewares/rateLimit', () => ({
  limitSignup:             (_req: unknown, _res: unknown, next: () => void) => next(),
  limitLogin:              (_req: unknown, _res: unknown, next: () => void) => next(),
  limitResendVerification: (_req: unknown, _res: unknown, next: () => void) => next(),
  limitVerification:       (_req: unknown, _res: unknown, next: () => void) => next(),
  limitModelsRead:         (_req: unknown, _res: unknown, next: () => void) => next(),
  limitModelsWrite:        (_req: unknown, _res: unknown, next: () => void) => next(),
  limitDriversRead:        (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../src/services/email.service', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import app from '../../src/app';
import pool from '../../src/config/database';
import { verifyToken } from '../../src/utils/jwt';

const mockQuery = pool.query as jest.Mock;
const mockVerifyToken = verifyToken as jest.Mock;

const ADMIN_TOKEN = 'Bearer admin-token';
const EDITOR_TOKEN = 'Bearer editor-token';

const adminRow = { id: 1, email: 'admin@example.com', role: 'Admin', contributor_id: null, is_verified: true };
const editorRow = { id: 2, email: 'editor@example.com', role: 'Editor', contributor_id: null, is_verified: true };

function mockAdminAuth() {
  mockVerifyToken.mockReturnValue({ uid: 1, email: adminRow.email, role: 'Admin' });
  mockQuery.mockResolvedValueOnce({ rows: [adminRow] });
}

function mockEditorAuth() {
  mockVerifyToken.mockReturnValue({ uid: 2, email: editorRow.email, role: 'Editor' });
  mockQuery.mockResolvedValueOnce({ rows: [editorRow] });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Access control ───────────────────────────────────────────────────────────

describe('Admin access control', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });

  it('returns 403 when a non-admin (Editor) calls an admin endpoint', async () => {
    mockEditorAuth();
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', EDITOR_TOKEN);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin access required/i);
  });
});

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────

describe('GET /api/admin/stats', () => {
  it('returns user counts and session count', async () => {
    mockAdminAuth();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 10 }] })
      .mockResolvedValueOnce({ rows: [{ count: 7 }] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] });

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalUsers: 10,
      verifiedUsers: 7,
      unverifiedUsers: 3,
      activeSessions: 0, // getConnectedUserCount() — no Socket.IO connections in test env
    });
  });

  it('returns 500 when DB throws', async () => {
    mockAdminAuth();
    mockQuery.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(500);
  });
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────

describe('GET /api/admin/users', () => {
  const userRow = {
    id: 5, name: 'Test User', email: 'test@example.com',
    role: 'Viewer', is_verified: true, created_at: new Date().toISOString(),
  };

  it('returns paginated user list', async () => {
    mockAdminAuth();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [userRow] });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.page).toBe(1);
    expect(res.body.totalPages).toBe(1);
  });

  it('supports ?search= and ?role= filters', async () => {
    mockAdminAuth();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/admin/users?search=test&role=Viewer')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(0);
  });

  it('returns 400 for an invalid role filter', async () => {
    mockAdminAuth();

    const res = await request(app)
      .get('/api/admin/users?role=SuperAdmin')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid role/i);
  });
});

// ─── PATCH /api/admin/users/:id/role ─────────────────────────────────────────

describe('PATCH /api/admin/users/:id/role', () => {
  it('updates a user role and writes an audit entry', async () => {
    mockAdminAuth();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })  // last-admin guard: COUNT(*) — 2 admins, guard passes
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, email: 'target@example.com', role: 'Editor' }] })
      .mockResolvedValueOnce({ rows: [] }); // logAction INSERT

    const res = await request(app)
      .patch('/api/admin/users/5/role')
      .set('Authorization', ADMIN_TOKEN)
      .send({ role: 'Editor' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('Editor');
    expect(res.body.message).toMatch(/role updated/i);
  });

  it('returns 404 when target user does not exist', async () => {
    mockAdminAuth();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })  // last-admin guard: COUNT(*) — 2 admins, guard passes
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });   // UPDATE — no user found

    const res = await request(app)
      .patch('/api/admin/users/999/role')
      .set('Authorization', ADMIN_TOKEN)
      .send({ role: 'Viewer' });

    expect(res.status).toBe(404);
  });

  it('returns 400 when admin tries to change their own role', async () => {
    mockAdminAuth();

    const res = await request(app)
      .patch('/api/admin/users/1/role')
      .set('Authorization', ADMIN_TOKEN)
      .send({ role: 'Viewer' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot change your own role/i);
  });

  it('returns 400 for an invalid role value', async () => {
    mockAdminAuth();

    const res = await request(app)
      .patch('/api/admin/users/5/role')
      .set('Authorization', ADMIN_TOKEN)
      .send({ role: 'SuperAdmin' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid role/i);
  });

  it('returns 400 for a non-numeric user id', async () => {
    mockAdminAuth();

    const res = await request(app)
      .patch('/api/admin/users/abc/role')
      .set('Authorization', ADMIN_TOKEN)
      .send({ role: 'Viewer' });

    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/admin/users/:id/sessions ────────────────────────────────────

describe('DELETE /api/admin/users/:id/sessions', () => {
  it('revokes all sessions for a user and audits the action', async () => {
    mockAdminAuth();
    mockQuery
      .mockResolvedValueOnce({ rowCount: 3 })  // DELETE sessions
      .mockResolvedValueOnce({ rows: [] });     // logAction INSERT

    const res = await request(app)
      .delete('/api/admin/users/5/sessions')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.message).toMatch(/sessions revoked/i);
  });

  it('returns 400 for a non-numeric user id', async () => {
    mockAdminAuth();

    const res = await request(app)
      .delete('/api/admin/users/abc/sessions')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/admin/users/:id ─────────────────────────────────────────────

describe('DELETE /api/admin/users/:id', () => {
  it('deletes a user and audits the action', async () => {
    mockAdminAuth();
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'target@example.com' }] }) // lookup
      .mockResolvedValueOnce({ rowCount: 1 })    // DELETE user
      .mockResolvedValueOnce({ rows: [] });       // logAction INSERT

    const res = await request(app)
      .delete('/api/admin/users/5')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/user deleted/i);
  });

  it('returns 404 when user does not exist', async () => {
    mockAdminAuth();
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(app)
      .delete('/api/admin/users/999')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(404);
  });

  it('returns 400 when admin tries to delete themselves', async () => {
    mockAdminAuth();

    const res = await request(app)
      .delete('/api/admin/users/1')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot delete your own account/i);
  });
});

// ─── GET /api/admin/audit-log ─────────────────────────────────────────────────

describe('GET /api/admin/audit-log', () => {
  it('returns the most recent audit log entries', async () => {
    mockAdminAuth();
    const logEntry = {
      id: 1, actor_id: 1, actor_email: 'admin@example.com',
      action: 'Changed role of user 5 to Editor', target_user_id: 5,
      metadata: null, created_at: new Date().toISOString(),
      actor_email_current: 'admin@example.com',
    };
    mockQuery.mockResolvedValueOnce({ rows: [logEntry] });

    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].action).toBe('Changed role of user 5 to Editor');
  });

  it('returns 500 when DB throws', async () => {
    mockAdminAuth();
    mockQuery.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(500);
  });
});
