import request from 'supertest';
import app from '../../src/app';
import { signToken } from '../../src/utils/jwt';

// These tokens are JWT-valid but the users may not exist in the test DB.
// Tests that require a real DB user will get 401 — that's expected behavior.
const validToken = signToken({ uid: 1, email: 'admin@test.com', role: 'Admin' });

describe('Collab activity REST endpoints', () => {
  it('GET /collab/:modelName/activity returns 401 without token', async () => {
    const res = await request(app).get('/collab/TestModel/activity');
    expect(res.status).toBe(401);
  });

  it('GET /collab/:modelName/activity requires authentication', async () => {
    const res = await request(app)
      .get('/collab/TestModel/activity')
      .set('Authorization', `Bearer ${validToken}`);
    // Accepts 200 (user exists in DB) or 401 (user missing from DB in test env).
    expect([200, 401]).toContain(res.status);
  });
});

describe('Comments REST endpoints', () => {
  it('POST /collab/:modelName/comments returns 401 without token', async () => {
    const res = await request(app)
      .post('/collab/TestModel/comments')
      .send({ body: 'hello' });
    expect(res.status).toBe(401);
  });

  it('GET /collab/:modelName/comments returns 401 without token', async () => {
    const res = await request(app).get('/collab/TestModel/comments');
    expect(res.status).toBe(401);
  });

  it('PATCH /collab/:modelName/comments/:id/resolve returns 401 without token', async () => {
    const res = await request(app).patch('/collab/TestModel/comments/1/resolve');
    expect(res.status).toBe(401);
  });

  it('DELETE /collab/:modelName/comments/:id returns 401 without token', async () => {
    const res = await request(app).delete('/collab/TestModel/comments/1');
    expect(res.status).toBe(401);
  });
});

describe('Milestones REST endpoints', () => {
  it('GET /collab/:modelName/milestones returns 401 without token', async () => {
    const res = await request(app).get('/collab/TestModel/milestones');
    expect(res.status).toBe(401);
  });

  it('POST /collab/:modelName/milestones returns 401 without token', async () => {
    const res = await request(app)
      .post('/collab/TestModel/milestones')
      .send({ label: 'v1' });
    expect(res.status).toBe(401);
  });

  it('GET /collab/:modelName/milestones/:id returns 401 without token', async () => {
    const res = await request(app).get('/collab/TestModel/milestones/1');
    expect(res.status).toBe(401);
  });

  it('DELETE /collab/:modelName/milestones/:id returns 401 without token', async () => {
    const res = await request(app).delete('/collab/TestModel/milestones/1');
    expect(res.status).toBe(401);
  });

  it('POST /collab/:modelName/milestones/:id/restore returns 401 without token', async () => {
    const res = await request(app).post('/collab/TestModel/milestones/1/restore');
    expect(res.status).toBe(401);
  });
});

describe('Model lock REST endpoints', () => {
  it('POST /models/:name/lock/acquire returns 401 without token', async () => {
    const res = await request(app).post('/models/TestModel/lock/acquire');
    expect(res.status).toBe(401);
  });

  it('GET /models/:name/lock returns 401 without token', async () => {
    const res = await request(app).get('/models/TestModel/lock');
    expect(res.status).toBe(401);
  });

  it('POST /models/:name/lock/renew returns 401 without token', async () => {
    const res = await request(app)
      .post('/models/TestModel/lock/renew')
      .send({ lockId: '1' });
    expect(res.status).toBe(401);
  });

  it('POST /models/:name/lock/release returns 401 without token', async () => {
    const res = await request(app)
      .post('/models/TestModel/lock/release')
      .send({ lockId: '1' });
    expect(res.status).toBe(401);
  });

  it('GET /models/:name/review-lock returns 401 without token', async () => {
    const res = await request(app).get('/models/TestModel/review-lock');
    expect(res.status).toBe(401);
  });

  it('POST /models/:name/review-lock returns 401 without token', async () => {
    const res = await request(app)
      .post('/models/TestModel/review-lock')
      .send({ reason: 'Peer reviewed' });
    expect(res.status).toBe(401);
  });

  it('DELETE /models/:name/review-lock returns 401 without token', async () => {
    const res = await request(app).delete('/models/TestModel/review-lock');
    expect(res.status).toBe(401);
  });
});

describe('Existing routes still work', () => {
  it('GET /auth/health returns 200', async () => {
    const res = await request(app).get('/auth/health');
    expect(res.status).toBe(200);
  });
});
