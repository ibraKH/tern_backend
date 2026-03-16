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
    connect: jest.fn(),
  },
}));

describe('locks.service', () => {
  const mockQuery = jest.fn();
  const mockRelease = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (pool.connect as jest.Mock).mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
  });

  it('User A acquires lock → success: true', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 1, expires_at: '2099-01-01T00:00:00.000Z' }],
    });

    await expect(
      acquireLock({
        entityType: 'node',
        entityId: 'n-1',
        modelName: 'Model A',
        userId: 1,
      })
    ).resolves.toEqual({ success: true });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO editing_locks'),
      ['node', 'n-1', 'Model A', 1]
    );
    expect(mockRelease).toHaveBeenCalled();
  });

  it('User A acquires same lock again → success: true (refresh, expires_at updated)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 1, expires_at: '2099-01-01T00:00:00.000Z' }],
    });

    await expect(
      acquireLock({
        entityType: 'edge',
        entityId: 'e-1',
        modelName: 'Model A',
        userId: 1,
      })
    ).resolves.toEqual({ success: true });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("NOW() + INTERVAL '30 seconds'"),
      ['edge', 'e-1', 'Model A', 1]
    );
  });

  it("User B tries to acquire User A's active lock → success: false, heldBy: A's email", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ user_id: 1, expires_at: '2099-01-01T00:00:00.000Z' }],
      })
      .mockResolvedValueOnce({
        rows: [{ email: 'user.a@example.com' }],
      });

    await expect(
      acquireLock({
        entityType: 'node',
        entityId: 'n-2',
        modelName: 'Model B',
        userId: 2,
      })
    ).resolves.toEqual({ success: false, heldBy: 'user.a@example.com' });

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SELECT email'),
      [1]
    );
  });

  it("User B acquires lock after A's lock has expired → success: true", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 2, expires_at: '2099-01-01T00:00:00.000Z' }],
    });

    await expect(
      acquireLock({
        entityType: 'edge',
        entityId: 'e-2',
        modelName: 'Model B',
        userId: 2,
      })
    ).resolves.toEqual({ success: true });
  });

  it('releaseLock by correct user → row deleted', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await expect(
      releaseLock({
        entityType: 'node',
        entityId: 'n-3',
        modelName: 'Model C',
        userId: 3,
      })
    ).resolves.toBe(1);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM editing_locks'),
      ['node', 'n-3', 'Model C', 3]
    );
  });

  it('releaseLock by wrong user → row still exists', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    await expect(
      releaseLock({
        entityType: 'edge',
        entityId: 'e-3',
        modelName: 'Model C',
        userId: 999,
      })
    ).resolves.toBe(0);
  });

  it('releaseAllLocksForSocket → all rows for user deleted, correct list returned', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { entityType: 'node', entityId: 'n-4', modelName: 'Model D' },
        { entityType: 'edge', entityId: 'e-4', modelName: 'Model D' },
      ],
    });

    await expect(releaseAllLocksForSocket(4)).resolves.toEqual([
      { entityType: 'node', entityId: 'n-4', modelName: 'Model D' },
      { entityType: 'edge', entityId: 'e-4', modelName: 'Model D' },
    ]);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM editing_locks'),
      [4]
    );
  });

  it('checkLockOwnership → true for owner with valid lock, false for expired, false for wrong user', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      checkLockOwnership({
        entityType: 'node',
        entityId: 'n-5',
        modelName: 'Model E',
        userId: 5,
      })
    ).resolves.toBe(true);

    await expect(
      checkLockOwnership({
        entityType: 'node',
        entityId: 'n-5',
        modelName: 'Model E',
        userId: 5,
      })
    ).resolves.toBe(false);

    await expect(
      checkLockOwnership({
        entityType: 'node',
        entityId: 'n-5',
        modelName: 'Model E',
        userId: 999,
      })
    ).resolves.toBe(false);
  });

  it('rejects invalid entityType', async () => {
    await expect(
      acquireLock({
        entityType: 'invalid' as never,
        entityId: 'n-1',
        modelName: 'Model A',
        userId: 1,
      })
    ).rejects.toThrow("entityType must be one of ['node', 'edge']");
  });

  it('rejects empty entityId and modelName', async () => {
    await expect(
      acquireLock({
        entityType: 'node',
        entityId: '   ',
        modelName: 'Model A',
        userId: 1,
      })
    ).rejects.toThrow('entityId must be a non-empty string');

    await expect(
      acquireLock({
        entityType: 'node',
        entityId: 'n-1',
        modelName: '',
        userId: 1,
      })
    ).rejects.toThrow('modelName must be a non-empty string');
  });
});