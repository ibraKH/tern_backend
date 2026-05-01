jest.mock('../../src/middlewares/auth.middleware', () => ({
  requireAuth: async (req: any, res: any, next: any) => {
    const auth = req.headers?.authorization as string | undefined;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    try {
      const { verifyToken } = require('../../src/utils/jwt');
      const pool = require('../../src/config/database').default;
      const payload = verifyToken(token);
      const result = await pool.query(
        'SELECT id, email, role, contributor_id FROM users WHERE id = $1',
        [payload.uid]
      );
      if (!result.rows.length) return res.status(401).json({ error: 'User not found' });
      req.user = {
        id: result.rows[0].id,
        email: result.rows[0].email,
        role: result.rows[0].role,
        contributor_id: result.rows[0].contributor_id ?? null,
      };
      return next();
    } catch {
      return res.status(401).json({ error: 'Cannot authenticate' });
    }
  },
}));

jest.mock('../../src/middlewares/requireAdmin', () => ({
  requireAdmin: (req: any, res: any, next: any) => {
    if (!req.user || req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return next();
  },
}));
jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../../src/utils/jwt', () => ({
  __esModule: true,
  verifyToken: jest.fn(),
}));

jest.mock('../../src/middlewares/rateLimit', () => ({
  limitSignup: (_req: any, _res: any, next: any) => next(),
  limitLogin: (_req: any, _res: any, next: any) => next(),
  limitResendVerification: (_req: any, _res: any, next: any) => next(),
  limitModelsRead: (_req: any, _res: any, next: any) => next(),
  limitModelsWrite: (_req: any, _res: any, next: any) => next(),
  limitDriversRead: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../src/services/email.service', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/app', () => {
  const express = require('express');
  const app = express();
  app.use(express.json());

  const adminRouter = require('../../src/routes/admin').default;
  const { requireAuth } = require('../../src/middlewares/auth.middleware');
  const { requireAdmin } = require('../../src/middlewares/requireAdmin');
  const { errorHandler } = require('../../src/middlewares/error.middleware');

  app.use('/admin', requireAuth, requireAdmin, adminRouter);
  app.use(errorHandler);

  return app;
});

// ─────────────────────────────────────────────

import request from 'supertest';
import app from '../../src/app';
import pool from '../../src/config/database';
import { verifyToken } from '../../src/utils/jwt';

const mockVerifyToken = verifyToken as jest.Mock;
const mockQuery = (pool as any).query as jest.Mock;
const mockConnect = (pool as any).connect as jest.Mock;

// ─────────────────────────────────────────────

const ADMIN_TOKEN = 'Bearer admin-token';
const EDITOR_TOKEN = 'Bearer editor-token';

const adminRow = {
  id: 1,
  email: 'admin@example.com',
  role: 'Admin',
};

const editorRow = {
  id: 2,
  email: 'editor@example.com',
  role: 'Editor',
};

// ─────────────────────────────────────────────

function mockAdminAuth() {
  mockVerifyToken.mockReturnValue({
    uid: 1,
    email: adminRow.email,
    role: 'Admin',
  });

  mockQuery.mockResolvedValueOnce({ rows: [adminRow] });
}

function mockEditorAuth() {
  mockVerifyToken.mockReturnValue({
    uid: 2,
    email: editorRow.email,
    role: 'Editor',
  });

  mockQuery.mockResolvedValueOnce({ rows: [editorRow] });
}

// ─────────────────────────────────────────────

describe('Admin Routes Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    });

    // Default fallback so BEGIN/COMMIT/ROLLBACK and other unqueued calls resolve cleanly.
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // ───── ACCESS CONTROL ─────
  describe('Access Control', () => {
    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get('/admin/stats');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      mockEditorAuth();

      const res = await request(app)
        .get('/admin/stats')
        .set('Authorization', EDITOR_TOKEN);

      expect(res.status).toBe(403);
    });
  });

  // ───── STATS ─────
  describe('GET /admin/stats', () => {
    it('returns stats correctly', async () => {
      mockAdminAuth();

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: 10 }] })
        .mockResolvedValueOnce({ rows: [{ count: 7 }] })
        .mockResolvedValueOnce({ rows: [{ count: 3 }] })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] });

      const res = await request(app)
        .get('/admin/stats')
        .set('Authorization', ADMIN_TOKEN);

      expect(res.status).toBe(200);
    });
  });

  // ───── ROLE UPDATE ─────
  describe('PATCH /admin/users/:id/role', () => {
    it('updates user role', async () => {
      mockAdminAuth();

      mockQuery
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 5, email: 'target@example.com', role: 'Editor' }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .patch('/admin/users/5/role')
        .set('Authorization', ADMIN_TOKEN)
        .send({ role: 'Editor' });

      expect(res.status).toBe(200);
    });
  });

  // ───── DRIVERS UPLOAD ─────
  describe('POST /admin/drivers/upload', () => {
    it('uploads valid CSV drivers (upsert)', async () => {
      mockAdminAuth();
      mockQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // upsertDriver

      const csv = `name,description,category
Driver1,desc1,cat1`;

      const res = await request(app)
        .post('/admin/drivers/upload')
        .set('Authorization', ADMIN_TOKEN)
        .attach('file', Buffer.from(csv), {
          filename: 'drivers.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(200);
    });

    it('uploads valid JSON nested structure', async () => {
      mockAdminAuth();
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // upsertDriver
        .mockResolvedValueOnce({ rows: [{ id: 2 }] }); // upsertSubDriver

      const json = [{
        name: 'Driver1',
        description: 'Description of Driver1',
        category: 'category1',
        sub_drivers: [{ name: 'Sub1', description: 'x' }],
      }];

      const res = await request(app)
        .post('/admin/drivers/upload')
        .set('Authorization', ADMIN_TOKEN)
        .attach('file', Buffer.from(JSON.stringify(json)), {
          filename: 'drivers.json',
          contentType: 'application/json',
        });

      expect(res.status).toBe(200);
    });

    it('rejects malformed CSV with row number in message (400)', async () => {
      mockAdminAuth();
      mockQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN (ROLLBACK uses default)

      const badCsv = `name,description\n,desc1`; // empty name triggers row 2 error

      const res = await request(app)
        .post('/admin/drivers/upload')
        .set('Authorization', ADMIN_TOKEN)
        .attach('file', Buffer.from(badCsv), {
          filename: 'bad.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(400);
      expect(res.body.error?.message).toMatch(/row 2/i);
    });

    it('rejects file > 5MB (413)', async () => {
      mockAdminAuth();

      const bigFile = Buffer.alloc(6 * 1024 * 1024);

      const res = await request(app)
        .post('/admin/drivers/upload')
        .set('Authorization', ADMIN_TOKEN)
        .attach('file', bigFile, {
          filename: 'big.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(413);
    });

    it('rejects unsupported MIME type (400)', async () => {
      mockAdminAuth();

      const res = await request(app)
        .post('/admin/drivers/upload')
        .set('Authorization', ADMIN_TOKEN)
        .attach('file', Buffer.from('some data'), {
          filename: 'drivers.txt',
          contentType: 'text/plain',
        });

      expect(res.status).toBe(400);
      expect(res.body.error?.message).toMatch(/invalid file type/i);
    });

    it('returns 400 when no file is attached', async () => {
      mockAdminAuth();

      const res = await request(app)
        .post('/admin/drivers/upload')
        .set('Authorization', ADMIN_TOKEN);

      expect(res.status).toBe(400);
      expect(res.body.error?.message).toMatch(/no file/i);
    });

    it('returns 403 for non-admin users', async () => {
      mockEditorAuth();

      const csv = `name,description,category
Driver1,desc1,cat1`;

      const res = await request(app)
        .post('/admin/drivers/upload')
        .set('Authorization', EDITOR_TOKEN)
        .attach('file', Buffer.from(csv), {
          filename: 'drivers.csv',
        });

      expect(res.status).toBe(403);
    });
  });

  // ───── TEMPLATE UPLOAD ─────
  describe('POST /admin/templates/upload', () => {
    it('imports model and marks as template', async () => {
      mockAdminAuth();

      const json = {
        stm_name: 'Template1',
        version: '1.0',
        release_date: '2025-01-01',
        authorised_by: 'Test',
        contributing_experts: [],
        region: 'Test Region',
        region_id: 0,
        climate: 'Test Climate',
        ecosystem_type: 'Test Ecosystem',
        aus_eco_archetype_code: 1,
        aus_eco_archetype_name: 'Test Archetype',
        aus_eco_umbrella_code: 1,
        peer_reviewed: 'No',
        no_peer_reviewers: 0,
        states: [],
        transitions: [],
      };

      mockQuery.mockImplementation(async (text: unknown) => {
        if (typeof text !== 'string') return { rows: [] };
        if (/^SELECT id FROM stmmodel WHERE stm_name/i.test(text)) return { rows: [] };
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
        if (/SELECT stm_name, is_locked/i.test(text)) return { rows: [] };
        if (/INSERT INTO stmmodel/i.test(text)) return { rows: [{ id: 123 }] };
        return { rows: [] };
      });

      const res = await request(app)
        .post('/admin/templates/upload')
        .set('Authorization', ADMIN_TOKEN)
        .attach('file', Buffer.from(JSON.stringify(json)), {
          filename: 'template.json',
          contentType: 'application/json',
        });

      expect(res.status).toBe(200);
    });

    it('rejects malformed JSON with descriptive message (400)', async () => {
      mockAdminAuth();

      const bad = '{ invalid json }';

      const res = await request(app)
        .post('/admin/templates/upload')
        .set('Authorization', ADMIN_TOKEN)
        .attach('file', Buffer.from(bad), {
          filename: 'template.json',
          contentType: 'application/json',
        });

      expect(res.status).toBe(400);
      expect(res.body.error?.message).toMatch(/invalid json/i);
    });

    it('rejects JSON that fails STM schema validation (400)', async () => {
      mockAdminAuth();

      const invalidSchema = { description: 'missing required name field' };

      const res = await request(app)
        .post('/admin/templates/upload')
        .set('Authorization', ADMIN_TOKEN)
        .attach('file', Buffer.from(JSON.stringify(invalidSchema)), {
          filename: 'template.json',
          contentType: 'application/json',
        });

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('rejects text/csv MIME type (400)', async () => {
      mockAdminAuth();

      const res = await request(app)
        .post('/admin/templates/upload')
        .set('Authorization', ADMIN_TOKEN)
        .attach('file', Buffer.from('name,description\nT1,d1'), {
          filename: 'template.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(400);
      expect(res.body.error?.message).toMatch(/invalid file type/i);
    });

    it('returns 400 when no file is attached', async () => {
      mockAdminAuth();

      const res = await request(app)
        .post('/admin/templates/upload')
        .set('Authorization', ADMIN_TOKEN);

      expect(res.status).toBe(400);
      expect(res.body.error?.message).toMatch(/no file/i);
    });

    it('returns 403 for non-admin users', async () => {
      mockEditorAuth();

      const res = await request(app)
        .post('/admin/templates/upload')
        .set('Authorization', EDITOR_TOKEN)
        .attach('file', Buffer.from(JSON.stringify({ name: 'T1' })), {
          filename: 'template.json',
          contentType: 'application/json',
        });

      expect(res.status).toBe(403);
    });

    it('rejects file > 5MB (413)', async () => {
      mockAdminAuth();

      const bigFile = Buffer.alloc(6 * 1024 * 1024);

      const res = await request(app)
        .post('/admin/templates/upload')
        .set('Authorization', ADMIN_TOKEN)
        .attach('file', bigFile, {
          filename: 'big.json',
          contentType: 'application/json',
        });

      expect(res.status).toBe(413);
    });
  });
});