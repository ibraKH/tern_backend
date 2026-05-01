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

let mockClient: any;

describe('health and templates of models router', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };

    (verifyToken as jest.Mock).mockReturnValue({
      uid: 1,
      email: 'admin@admin.com',
      role: 'Editor',
      contributor_id: 1,
    });

    (pool.query as jest.Mock).mockResolvedValue({
      rows: [
        { id: 1, email: 'admin@admin.com', role: 'Editor', contributor_id: 1 },
      ],
    });

    (pool as any).connect = jest.fn().mockResolvedValue(mockClient);
  });

  it('GET /models/health returns ok', async () => {
    const res = await request(app)
      .get('/models/health')
      .set('Authorization', 'Bearer any-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'Models service is healthy' });
  });

  it('GET /models/templates returns only template model names', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [
        { stm_name: 'Template A' },
        { stm_name: 'Template B' },
      ],
    });

    const res = await request(app)
      .get('/models/templates')
      .set('Authorization', 'Bearer any-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(['Template A', 'Template B']);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT stm_name FROM stmmodel WHERE is_template = TRUE')
    );
  });

  it('PATCH /models/:name/template returns 403 when user is not admin or owner', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/models/my-template/template')
      .send({ flag: true })
      .set('Authorization', 'Bearer any-token');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Admin or owner required to update template flag' });
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT c.id, LOWER(c.email) AS email'),
      ['my-template']
    );
  });

  it('PATCH /models/:name/template — Admin user succeeds (returns 200 { success: true })', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 1, email: 'admin@admin.com', role: 'Admin', contributor_id: 1 }],
    });

    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // UPDATE stmmodel SET is_template

    const res = await request(app)
      .patch('/models/my-template/template')
      .send({ flag: true })
      .set('Authorization', 'Bearer any-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('POST /models/from-template/:name returns 404 when the template name does not exist', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // template fetch — not found
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const res = await request(app)
      .post('/models/from-template/NonExistentTemplate')
      .send({ new_name: 'Cloned Model' })
      .set('Authorization', 'Bearer any-token');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Template with name 'NonExistentTemplate' not found" });
  });

  it('POST /models/from-template/:name returns 400 when new_name is missing', async () => {
    const res = await request(app)
      .post('/models/from-template/Template%20A')
      .send({})
      .set('Authorization', 'Bearer any-token');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'new_name is required and must be a non-empty string' });
  });

  it('POST /models/from-template/:name clones a template and returns the new model id', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            stm_name: 'Template A',
            version: '1.0',
            release_date: '2024-01-01',
            authorised_by: 'Template Author',
            region: 'QLD',
            region_id: null,
            ecosystem_type: 'Rainforest',
            aus_eco_archetype_code: '1',
            aus_eco_archetype_name: 'Archetype',
            aus_eco_umbrella_code: 7,
            peer_reviewed: 'true',
            no_peer_reviewers: 2,
            climate: 'Tropical',
          },
        ],
      }) // template fetch
      .mockResolvedValueOnce({ rows: [] }) // region check
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // new model insert
      .mockResolvedValueOnce({ rows: [] }) // model_contributions insert
      .mockResolvedValueOnce({ rows: [] }) // states SELECT
      .mockResolvedValueOnce({ rows: [] }) // transitions SELECT
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = await request(app)
      .post('/models/from-template/Template%20A')
      .send({ new_name: 'Cloned Model' })
      .set('Authorization', 'Bearer any-token');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, modelId: 42, stm_name: 'Cloned Model' });
  });
});

describe('review lock routes and save enforcement', () => {
  const MODEL_NAME = 'LockedModel';

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    (pool as any).connect = jest.fn().mockResolvedValue(mockClient);

    const users = {
      'admin-token': { uid: 1, email: 'admin@admin.com', role: 'Admin', contributor_id: 1 },
      'editor-token': { uid: 2, email: 'editor@editor.com', role: 'Editor', contributor_id: 2 },
    } as const;

    const lockState = {
      is_locked: false,
      locked_by: null as string | null,
      locked_at: null as string | null,
      lock_reason: null as string | null,
    };

    (verifyToken as jest.Mock).mockImplementation((token: string) => users[token as keyof typeof users]);

    (pool.query as jest.Mock).mockImplementation(async (sql: string, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('FROM auth_users') && text.includes('WHERE id = $1')) {
        const user = Object.values(users).find((entry) => entry.uid === params?.[0]);
        return { rows: user ? [{ id: user.uid, email: user.email, role: user.role, contributor_id: user.contributor_id }] : [] };
      }
      if (text.includes('SELECT role FROM model_permissions') && text.includes('WHERE stm_name = $1')) {
        // grant editor a viewer role on this model
        const userEmail = String(params?.[1] ?? '').toLowerCase();
        if (userEmail === 'editor@editor.com') return { rows: [{ role: 'editor' }] };
        return { rows: [] };
      }
      if (text.includes('SELECT stm_name, is_locked, locked_by, locked_at, lock_reason') && text.includes('WHERE stm_name = $1')) {
        return { rows: [{ stm_name: MODEL_NAME, ...lockState }] };
      }
      if (text.includes('SELECT id FROM stmmodel WHERE stm_name = $1')) {
        return { rows: [{ id: 1 }] };
      }
      if (text.includes('SET is_locked = TRUE')) {
        lockState.is_locked = true;
        lockState.locked_by = String(params?.[1] ?? 'admin@admin.com');
        lockState.lock_reason = (params?.[2] as string | null) ?? null;
        lockState.locked_at = '2026-04-29T00:00:00.000Z';
        return { rows: [{ stm_name: MODEL_NAME, ...lockState }] };
      }
      if (text.includes('SET is_locked = FALSE')) {
        lockState.is_locked = false;
        lockState.locked_by = null;
        lockState.locked_at = null;
        lockState.lock_reason = null;
        return { rows: [{ stm_name: MODEL_NAME, ...lockState }] };
      }
      if (text.includes('INSERT INTO collab_activity')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      const text = String(sql);

      if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
        return { rows: [] };
      }

      if (text.includes('SELECT stm_name, is_locked, locked_by, locked_at, lock_reason') && text.includes('WHERE id = $1')) {
        return { rows: [{ stm_name: MODEL_NAME, ...lockState }] };
      }

      if (text.includes('SELECT stm_name, is_locked, locked_by, locked_at, lock_reason') && text.includes('WHERE stm_name = $1')) {
        return { rows: [{ stm_name: MODEL_NAME, ...lockState }] };
      }

      if (text.includes('SELECT id, stm_name, version, release_date') && text.includes('FROM stmmodel')) {
        return {
          rows: [{
            id: 1,
            stm_name: MODEL_NAME,
            version: 'v1',
            release_date: '2026-01-01',
            authorised_by: 'Admin',
            region: 'R',
            region_id: 1,
            ecosystem_type: 'E',
            aus_eco_archetype_code: '1',
            aus_eco_archetype_name: 'Arc',
            aus_eco_umbrella_code: '1',
            peer_reviewed: 'Yes',
            no_peer_reviewers: 2,
            climate: 'C',
            is_template: false,
            is_locked: lockState.is_locked,
            locked_by: lockState.locked_by,
            locked_at: lockState.locked_at,
            lock_reason: lockState.lock_reason,
          }],
        };
      }

      if (text.includes('FROM model_contributions')) return { rows: [] };
      if (text.includes('FROM states s') && text.includes('LEFT JOIN vast_states')) return { rows: [] };
      if (text.includes('FROM transitions t')) return { rows: [] };
      if (text.includes('FROM method_alignment')) return { rows: [] };

      if (text.includes('UPDATE stmmodel') && text.includes('RETURNING id')) {
        return { rows: [{ id: 1 }] };
      }

      return { rows: [] };
    });
  });

  it('allows Admin to lock/unlock and blocks save while locked', async () => {
    const lockRes = await request(app)
      .post(`/models/${MODEL_NAME}/review-lock`)
      .set('Authorization', 'Bearer admin-token')
      .send({ reason: 'Peer reviewed 2026-04-29' });

    expect(lockRes.status).toBe(200);
    expect(lockRes.body).toMatchObject({
      success: true,
      is_locked: true,
      locked_by: 'admin@admin.com',
      lock_reason: 'Peer reviewed 2026-04-29',
    });

    const statusRes = await request(app)
      .get(`/models/${MODEL_NAME}/review-lock`)
      .set('Authorization', 'Bearer editor-token');

    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({
      is_locked: true,
      locked_by: 'admin@admin.com',
      lock_reason: 'Peer reviewed 2026-04-29',
    });

    const getModelRes = await request(app)
      .get(`/models/${MODEL_NAME}`)
      .set('Authorization', 'Bearer editor-token');

    expect(getModelRes.status).toBe(200);
    expect(getModelRes.body).toMatchObject({
      stm_name: MODEL_NAME,
      is_locked: true,
      locked_by: 'admin@admin.com',
      lock_reason: 'Peer reviewed 2026-04-29',
    });

    const savePayload = {
      id: 1,
      stm_name: MODEL_NAME,
      version: 'v2',
      release_date: '2026-01-01',
      authorised_by: 'Admin',
      region: 'R',
      region_id: 1,
      climate: 'C',
      ecosystem_type: 'E',
      aus_eco_archetype_code: 1,
      aus_eco_archetype_name: 'Arc',
      aus_eco_umbrella_code: 1,
      peer_reviewed: 'Yes',
      no_peer_reviewers: 2,
      contributing_experts: [],
      states: [],
      transitions: [],
    };

    const lockedSaveRes = await request(app)
      .post('/models/save')
      .set('Authorization', 'Bearer editor-token')
      .send(savePayload);

    expect(lockedSaveRes.status).toBe(403);
    expect(lockedSaveRes.body).toEqual({ message: 'Model is locked for review' });

    const unlockRes = await request(app)
      .delete(`/models/${MODEL_NAME}/review-lock`)
      .set('Authorization', 'Bearer admin-token');

    expect(unlockRes.status).toBe(200);
    expect(unlockRes.body).toMatchObject({ success: true, is_locked: false });

    const unlockedSaveRes = await request(app)
      .post('/models/save')
      .set('Authorization', 'Bearer editor-token')
      .send(savePayload);

    expect(unlockedSaveRes.status).toBe(201);
    expect(unlockedSaveRes.body.success).toBe(true);
  });

  it('returns 403 when a non-Admin tries to change review lock state', async () => {
    const lockRes = await request(app)
      .post(`/models/${MODEL_NAME}/review-lock`)
      .set('Authorization', 'Bearer editor-token')
      .send({ reason: 'Peer reviewed' });

    expect(lockRes.status).toBe(403);

    const unlockRes = await request(app)
      .delete(`/models/${MODEL_NAME}/review-lock`)
      .set('Authorization', 'Bearer editor-token');

    expect(unlockRes.status).toBe(403);
  });
});
