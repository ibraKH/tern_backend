import request from 'supertest';
import app from '../../src/app';

describe('404 handler', () => {
  // Redirect to frontend notfound page
  it('redirects to frontend not found page', async () => {
    const res = await request(app).get('/some/unknown/route');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('https://stm-xm7jh.ondigitalocean.app/notfound');
  });
});
