import request from 'supertest';
import app from '../../src/app';

describe('health of auth router', () => {
  it('GET /auth returns ok', async () => {
    const res = await request(app).get('/auth/health');
    expect(res.status).toBe(200);
  });
});