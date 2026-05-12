import request from 'supertest';
import app, { normalizeCorsOrigin } from '../../src/app';

describe('CORS', () => {
  it('allows preflight requests from the deployed frontend origin', async () => {
    const origin = 'https://stm-8nizc.ondigitalocean.app';

    const res = await request(app)
      .options('/models/save')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
  });

  it('normalizes configured frontend URLs to origins', () => {
    expect(normalizeCorsOrigin('https://stm-8nizc.ondigitalocean.app/editor?model=BMRG%20Rainforests'))
      .toBe('https://stm-8nizc.ondigitalocean.app');
    expect(normalizeCorsOrigin('https://stm-8nizc.ondigitalocean.app/'))
      .toBe('https://stm-8nizc.ondigitalocean.app');
  });
});
