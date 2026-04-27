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

describe('health and templates of models router', () => {
  let mockClient: any;

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
