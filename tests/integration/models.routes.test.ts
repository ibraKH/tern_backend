import request from 'supertest';
import app from '../../src/app';
import { signToken } from '../../src/utils/jwt';

describe('health of models router', () => {
  it('GET /models/health returns ok', async () => {
    const token = signToken({ uid: 1, email: 'admin@admin.com', role: 'admin' });
    const res = await request(app)
      .get('/models/health')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});