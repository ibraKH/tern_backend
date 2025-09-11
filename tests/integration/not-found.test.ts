import request from 'supertest';
import app from '../../src/app';

describe('404 handler', () => {
  it('returns 404 JSON on unknown route', async () => {
    const res = await request(app).get('/missing/route/here');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Page not found' });
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
