import pool from '../../../../src/config/database';
import {
  acquireLock,
  releaseLock,
  releaseAllLocksForSocket,
  checkLockOwnership,
} from '../../../../src/services/collab/locks.service';

jest.mock('../../../../src/config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

describe('locks.service', () => {
  const mockQuery = pool.query as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('acquireLock: resolves modelName -> model_id and inserts into collab_locks', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 101 }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 1 }] });

    await expect(
      acquireLock({
        entityType: 'node',
        entityId: '42',
        modelName: 'Model A',
        userId: 1,
      })
    ).resolves.toEqual({ success: true });

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      'SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1',
      ['Model A']
    );

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO collab_locks'),
      [101, 'node', 42, 1]
    );

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('ON CONFLICT (model_id, entity_type, entity_id)'),
      [101, 'node', 42, 1]
    );
  });

  it('acquireLock: same user can refresh existing lock', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 202 }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] });

    await expect(
      acquireLock({
        entityType: 'edge',
        entityId: 99,
        modelName: 'Model Refresh',
        userId: 7,
      })
    ).resolves.toEqual({ success: true });

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("NOW() + INTERVAL '30 seconds'"),
      [202, 'edge', 99, 7]
    );
  });

  it("acquireLock: returns success false and holder email when another user's lock is active", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 303 }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 11 }] })
      .mockResolvedValueOnce({ rows: [{ email: 'owner@example.com' }] });

    await expect(
      acquireLock({
        entityType: 'node',
        entityId: '55',
        modelName: 'Model Locked',
        userId: 22,
      })
    ).resolves.toEqual({ success: false, heldBy: 'owner@example.com' });

    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('FROM auth_users'),
      [11]
    );
  });

  it('acquireLock: returns heldBy null when auth_users row is missing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 404 }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 33 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      acquireLock({
        entityType: 'edge',
        entityId: '88',
        modelName: 'Model Missing User',
        userId: 44,
      })
    ).resolves.toEqual({ success: false, heldBy: null });
  });

  it('releaseLock: deletes from collab_locks using resolved model_id and integer entity_id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 505 }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    await expect(
      releaseLock({
        entityType: 'node',
        entityId: '123',
        modelName: 'Model C',
        userId: 3,
      })
    ).resolves.toBe(1);

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      'SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1',
      ['Model C']
    );

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM collab_locks'),
      [505, 'node', 123, 3]
    );
  });

  it('releaseLock: returns 0 when no lock row matched', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 606 }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    await expect(
      releaseLock({
        entityType: 'edge',
        entityId: 456,
        modelName: 'Model D',
        userId: 999,
      })
    ).resolves.toBe(0);
  });

  it('releaseAllLocksForSocket: deletes all user locks and returns entity/model names', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { entityType: 'node', entityId: 10, modelName: 'Model X' },
        { entityType: 'edge', entityId: 11, modelName: 'Model Y' },
      ],
    });

    await expect(releaseAllLocksForSocket(4)).resolves.toEqual([
      { entityType: 'node', entityId: 10, modelName: 'Model X' },
      { entityType: 'edge', entityId: 11, modelName: 'Model Y' },
    ]);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM collab_locks cl'),
      [4]
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('USING stmmodel sm'),
      [4]
    );
  });

  it('checkLockOwnership: true when matching active lock exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 707 }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    await expect(
      checkLockOwnership({
        entityType: 'node',
        entityId: '900',
        modelName: 'Model E',
        userId: 5,
      })
    ).resolves.toBe(true);

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM collab_locks'),
      [707, 'node', 900, 5]
    );

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('expires_at > NOW()'),
      [707, 'node', 900, 5]
    );
  });

  it('checkLockOwnership: false when no active lock exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 808 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      checkLockOwnership({
        entityType: 'edge',
        entityId: 901,
        modelName: 'Model F',
        userId: 6,
      })
    ).resolves.toBe(false);
  });

  it('throws when modelName cannot be resolved', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      acquireLock({
        entityType: 'node',
        entityId: '1',
        modelName: 'Unknown Model',
        userId: 1,
      })
    ).rejects.toThrow('Model not found: Unknown Model');
  });

  it('rejects invalid entityType', async () => {
    await expect(
      acquireLock({
        entityType: 'invalid' as never,
        entityId: '1',
        modelName: 'Model A',
        userId: 1,
      })
    ).rejects.toThrow("entityType must be one of ['node', 'edge']");
  });

  it('rejects empty modelName', async () => {
    await expect(
      acquireLock({
        entityType: 'node',
        entityId: '1',
        modelName: '   ',
        userId: 1,
      })
    ).rejects.toThrow('modelName must be a non-empty string');
  });

  it('rejects invalid entityId values', async () => {
    await expect(
      acquireLock({
        entityType: 'node',
        entityId: '   ',
        modelName: 'Model A',
        userId: 1,
      })
    ).rejects.toThrow('entityId must be a non-empty string or positive integer');

    await expect(
      acquireLock({
        entityType: 'node',
        entityId: 'abc',
        modelName: 'Model A',
        userId: 1,
      })
    ).rejects.toThrow('entityId must be a positive integer');

    await expect(
      acquireLock({
        entityType: 'node',
        entityId: 0,
        modelName: 'Model A',
        userId: 1,
      })
    ).rejects.toThrow('entityId must be a positive integer');
  });

  it('rejects invalid userId', async () => {
    await expect(
      releaseAllLocksForSocket(0)
    ).rejects.toThrow('userId must be a positive integer');
  });
});