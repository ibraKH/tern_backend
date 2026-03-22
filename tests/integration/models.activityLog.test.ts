jest.mock('../../src/config/database', () => {
  const client = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      query: jest.fn(),
      connect: jest.fn(async () => client),
      _client: client,
    },
  };
});

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
import { logActivity } from '../../src/services/collab/activity.service';
import { io } from '../../src/socket';

const AUTH_HEADER = { Authorization: 'Bearer any-token' };

const mockClient = (pool as unknown as { _client: { query: jest.Mock; release: jest.Mock } })._client;

// Helper: set auth mocks for a given role.
function mockAuth(role: 'Editor' | 'Admin') {
  (verifyToken as jest.Mock).mockReturnValue({
    uid: 1,
    email: 'user@example.com',
    role,
  });
  (pool.query as jest.Mock).mockResolvedValue({
    rows: [{ id: 1, email: 'user@example.com', role, contributor_id: null }],
  });
}

beforeEach(() => {
  // mockReset clears the once-queue, preventing leaks between tests.
  mockClient.query.mockReset().mockResolvedValue({ rows: [] });
  (logActivity as jest.Mock).mockReset().mockResolvedValue(undefined);
  (io.to as jest.Mock).mockReset().mockReturnValue({ emit: jest.fn() });

  jest.clearAllMocks();
  mockAuth('Editor');
});

// Allow fire-and-forget promises to settle before assertions.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('activity logging on model save', () => {
  it('logs model_created after a new model is saved', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)                       // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })          // region check
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })         // INSERT stmmodel
      .mockResolvedValueOnce(undefined);                      // COMMIT

    const res = await request(app)
      .post('/models/save')
      .set(AUTH_HEADER)
      .send({ stm_name: 'TestModel', region_id: 1, states: [], transitions: [] });

    expect(res.status).toBe(201);
    await flush();

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'TestModel',
        userId: 1,
        action: 'model_created',
      }),
    );
    expect(io.to).toHaveBeenCalledWith('name:TestModel');
  });

  it('logs model_edited when updating an existing model', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)                       // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })          // UPDATE stmmodel
      .mockResolvedValueOnce(undefined);                      // COMMIT

    const res = await request(app)
      .post('/models/save')
      .set(AUTH_HEADER)
      .send({ id: 5, stm_name: 'Existing', states: [], transitions: [] });

    expect(res.status).toBe(201);
    await flush();

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'model_edited',
        modelName: 'Existing',
      }),
    );
  });

  it('does not log activity when save fails', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)                       // BEGIN
      .mockRejectedValueOnce(new Error('DB error'))           // region check fails
      .mockResolvedValueOnce(undefined);                      // ROLLBACK

    const res = await request(app)
      .post('/models/save')
      .set(AUTH_HEADER)
      .send({ stm_name: 'BadModel', region_id: 1 });

    expect(res.status).toBe(500);
    await flush();

    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe('activity logging on model delete', () => {
  it('logs model_deleted after removing a model', async () => {
    // DELETE /models/:name requires Admin role
    mockAuth('Admin');

    mockClient.query
      .mockResolvedValueOnce(undefined)                               // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 10, stm_name: 'X' }] }) // SELECT model
      .mockResolvedValueOnce({ rows: [] })                            // SELECT states
      .mockResolvedValueOnce(undefined)                               // DELETE contributions
      .mockResolvedValueOnce(undefined)                               // DELETE stmmodel
      .mockResolvedValueOnce(undefined);                              // COMMIT

    const res = await request(app)
      .delete('/models/TestModel')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    await flush();

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'TestModel',
        userId: 1,
        action: 'model_deleted',
      }),
    );
    expect(io.to).toHaveBeenCalledWith('name:TestModel');
  });
});

describe('activity logging on state/transition delete', () => {
  it('logs state_deleted with entityType and entityId', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)                       // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 20 }] })         // SELECT state
      .mockResolvedValueOnce({ rows: [] })                    // SELECT transitions (none)
      .mockResolvedValueOnce(undefined)                       // DELETE state
      .mockResolvedValueOnce(undefined);                      // COMMIT

    const res = await request(app)
      .delete('/models/Forest/states/20')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    await flush();

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'Forest',
        action: 'state_deleted',
        entityType: 'state',
        entityId: 20,
      }),
    );
  });

  it('logs transition_deleted with entityType and entityId', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)                       // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 99 }] })         // SELECT transition
      .mockResolvedValueOnce(undefined)                       // DELETE method_causal_chain
      .mockResolvedValueOnce(undefined)                       // DELETE causal_chain
      .mockResolvedValueOnce(undefined)                       // DELETE transition
      .mockResolvedValueOnce(undefined);                      // COMMIT

    const res = await request(app)
      .delete('/models/Forest/transitions/55')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    await flush();

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'Forest',
        action: 'transition_deleted',
        entityType: 'transition',
        entityId: 55,
      }),
    );
  });
});

describe('broadcast failure does not break HTTP response', () => {
  it('returns 201 even when logActivity rejects', async () => {
    (logActivity as jest.Mock).mockRejectedValueOnce(new Error('broadcast down'));

    mockClient.query
      .mockResolvedValueOnce(undefined)                       // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })          // region check
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })          // INSERT stmmodel
      .mockResolvedValueOnce(undefined);                      // COMMIT

    const res = await request(app)
      .post('/models/save')
      .set(AUTH_HEADER)
      .send({ stm_name: 'Safe', region_id: 1, states: [], transitions: [] });

    // The HTTP response must still succeed
    expect(res.status).toBe(201);
    await flush();
  });
});
