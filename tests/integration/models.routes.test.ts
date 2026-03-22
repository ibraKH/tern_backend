jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock('../../src/utils/jwt', () => ({
  __esModule: true,
  verifyToken: jest.fn(),
}));

jest.mock('../../src/services/collab/activity.service', () => ({
  __esModule: true,
  logActivity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/socket', () => ({
  __esModule: true,
  io: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) },
}));

import request from 'supertest';

import app from '../../src/app';
import pool from '../../src/config/database';
import { verifyToken } from '../../src/utils/jwt';

describe('health of models router', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (verifyToken as jest.Mock).mockReturnValue({
      uid: 1,
      email: 'admin@admin.com',
      role: 'Editor',
    });

    (pool.query as jest.Mock).mockResolvedValue({
      rows: [
        { id: 1, email: 'admin@admin.com', role: 'Editor', contributor_id: null },
      ],
    });
  });

  it('GET /models/health returns ok', async () => {
    const res = await request(app)
      .get('/models/health')
      .set('Authorization', 'Bearer any-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'Models service is healthy' });
  });
});