import request from 'supertest';
import app from '../../src/app';

describe('health of models router', () => {
  it('GET /models returns ok', async () => {
    const res = await request(app).get('/models');
    expect(res.status).toBe(200);
  });
});