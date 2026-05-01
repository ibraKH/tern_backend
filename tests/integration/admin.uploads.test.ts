jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock('../../src/utils/jwt', () => ({
  __esModule: true,
  verifyToken: jest.fn(),
}));

jest.mock('../../src/services/models/save.service', () => ({
  __esModule: true,
  saveModel: jest.fn(),
  flagAsTemplate: jest.fn(),
}));

import request from 'supertest';
import app from '../../src/app';
import pool from '../../src/config/database';
import { verifyToken } from '../../src/utils/jwt';
import { saveModel, flagAsTemplate } from '../../src/services/models/save.service';

const mockQuery = pool.query as jest.Mock;
const mockVerify = verifyToken as jest.Mock;
const mockSaveModel = saveModel as jest.Mock;
const mockFlagAsTemplate = flagAsTemplate as jest.Mock;

const ADMIN = { id: 1, email: 'admin@example.com', role: 'Admin', contributor_id: null };
const EDITOR = { id: 2, email: 'editor@example.com', role: 'Editor', contributor_id: null };

function setAuthUser(user: typeof ADMIN | typeof EDITOR) {
  mockVerify.mockReturnValue({ uid: user.id, email: user.email, role: user.role });
}

function makeQueryMock(handlers: Array<(sql: string, params?: unknown[]) => { rows?: unknown[] } | undefined>) {
  return (sql: string, params?: unknown[]) => {
    const s = String(sql);

    // auth middleware lookup
    if (s.includes('FROM auth_users')) {
      const uid = (params?.[0] as number) ?? ADMIN.id;
      if (uid === ADMIN.id) return Promise.resolve({ rows: [ADMIN] });
      if (uid === EDITOR.id) return Promise.resolve({ rows: [EDITOR] });
      return Promise.resolve({ rows: [] });
    }

    for (const h of handlers) {
      const res = h(s, params);
      if (res) return Promise.resolve({ rows: res.rows ?? [] });
    }

    return Promise.resolve({ rows: [] });
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockVerify.mockReset();
  mockSaveModel.mockReset();
  mockFlagAsTemplate.mockReset();

  setAuthUser(ADMIN);
  mockQuery.mockImplementation(makeQueryMock([]));
});

// ─── POST /admin/drivers/upload ─────────────────────────────────────────────

describe('POST /admin/drivers/upload', () => {
  it('upserts drivers from CSV', async () => {
    const csv = ['name,description,category', 'Fire regime,Altered fire,Disturbance'].join('\n');

    // drivers select -> not found, then insert -> id, then no sub_driver path
    mockQuery.mockImplementation(
      makeQueryMock([
        (sql, params) => {
          if (sql.includes('SELECT id FROM drivers') && (params?.[0] as string) === 'Fire regime') {
            return { rows: [] };
          }
          return undefined;
        },
        (sql) => {
          if (sql.includes('INSERT INTO drivers')) {
            return { rows: [{ id: 123 }] };
          }
          return undefined;
        },
      ])
    );

    const res = await request(app)
      .post('/admin/drivers/upload')
      .set('Authorization', 'Bearer admin-token')
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'drivers.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.driversUpserted).toBe(1);
  });

  it('upserts drivers + sub-drivers from JSON', async () => {
    const json = JSON.stringify([
      {
        name: 'Grazing',
        description: 'Herbivory pressure',
        sub_drivers: [{ name: 'biotic', description: 'Biotic driver type' }],
      },
    ]);

    mockQuery.mockImplementation(
      makeQueryMock([
        // driver lookup -> not found
        (sql, params) => {
          if (sql.includes('SELECT id FROM drivers') && (params?.[0] as string) === 'Grazing') {
            return { rows: [] };
          }
          return undefined;
        },
        // driver insert
        (sql) => {
          if (sql.includes('INSERT INTO drivers')) return { rows: [{ id: 7 }] };
          return undefined;
        },
        // sub_driver lookup -> not found
        (sql) => {
          if (sql.includes('SELECT id FROM sub_drivers')) return { rows: [] };
          return undefined;
        },
      ])
    );

    const res = await request(app)
      .post('/admin/drivers/upload')
      .set('Authorization', 'Bearer admin-token')
      .attach('file', Buffer.from(json, 'utf8'), { filename: 'drivers.json', contentType: 'application/json' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.driversUpserted).toBe(1);
    expect(res.body.subDriversUpserted).toBe(1);
  });

  it('returns 403 for non-Admin users', async () => {
    setAuthUser(EDITOR);

    const csv = 'name,description,category\nX,Y,Z';
    const res = await request(app)
      .post('/admin/drivers/upload')
      .set('Authorization', 'Bearer editor-token')
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'drivers.csv', contentType: 'text/csv' });

    expect(res.status).toBe(403);
  });

  it('returns 413 when file exceeds 5MB', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0);

    const res = await request(app)
      .post('/admin/drivers/upload')
      .set('Authorization', 'Bearer admin-token')
      .attach('file', big, { filename: 'drivers.csv', contentType: 'text/csv' });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 400 with row number on malformed CSV', async () => {
    const csv = ['name,description,category', 'OnlyOneColumn'].join('\n');

    const res = await request(app)
      .post('/admin/drivers/upload')
      .set('Authorization', 'Bearer admin-token')
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'drivers.csv', contentType: 'text/csv' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(String(res.body.error.message)).toMatch(/row 2/i);
  });
});

// ─── POST /admin/templates/upload ────────────────────────────────────────────

describe('POST /admin/templates/upload', () => {
  it('imports a template model and marks it as template', async () => {
    mockSaveModel.mockResolvedValueOnce({ modelId: 99 });
    mockFlagAsTemplate.mockResolvedValueOnce(undefined);

    const modelJson = {
      stm_name: 'Template Model 1',
      states: [],
      transitions: [],
      contributing_experts: [],
    };

    const res = await request(app)
      .post('/admin/templates/upload')
      .set('Authorization', 'Bearer admin-token')
      .attach('file', Buffer.from(JSON.stringify(modelJson), 'utf8'), {
        filename: 'model.json',
        contentType: 'application/json',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.modelId).toBe(99);
    expect(res.body.stm_name).toBe('Template Model 1');
    expect(mockFlagAsTemplate).toHaveBeenCalledWith('Template Model 1', true, 'Admin', ADMIN.email);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app)
      .post('/admin/templates/upload')
      .set('Authorization', 'Bearer admin-token')
      .attach('file', Buffer.from('{not-json', 'utf8'), {
        filename: 'model.json',
        contentType: 'application/json',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
