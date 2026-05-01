import pool from '../../../src/config/database';
import { acquireLock, releaseLock, releaseAllLocksForUser, checkLockOwnership, cleanupExpiredLocks } from '../../../src/services/collab/locks.service';

jest.mock('../../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

const mockQuery = pool.query as jest.Mock;

describe('locks.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('acquireLock', () => {
    const params = { entityType: 'node', entityId: 42, modelName: 'M1', userId: 1 };

    it('inserts a new lock when no existing lock', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })   // model lookup
        .mockResolvedValueOnce({ rows: [] })               // no existing lock
        .mockResolvedValueOnce({ rowCount: 1 });           // insert

      const result = await acquireLock(params);
      expect(result).toEqual({ success: true });
    });

    it('refreshes TTL when same user re-acquires', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({ rows: [{ user_id: 1, expires_at: new Date(Date.now() + 30000).toISOString(), email: 'a@b.com' }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await acquireLock(params);
      expect(result).toEqual({ success: true });
    });

    it('returns denied when another user holds active lock', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({ rows: [{ user_id: 99, expires_at: new Date(Date.now() + 30000).toISOString(), email: 'other@b.com' }] });

      const result = await acquireLock(params);
      expect(result).toEqual({ success: false, heldBy: 'other@b.com' });
    });

    it('takes over an expired lock from another user', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({ rows: [{ user_id: 99, expires_at: new Date(Date.now() - 5000).toISOString(), email: 'old@b.com' }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await acquireLock(params);
      expect(result).toEqual({ success: true });
    });

    it('rejects invalid entityType', async () => {
      await expect(acquireLock({ ...params, entityType: 'invalid' })).rejects.toThrow('Invalid entityType');
    });
  });

  describe('releaseLock', () => {
    it('deletes the lock and returns count', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      const count = await releaseLock({ entityType: 'node', entityId: 1, modelName: 'M1', userId: 1 });
      expect(count).toBe(1);
    });

    it('returns 0 when model not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const count = await releaseLock({ entityType: 'node', entityId: 1, modelName: 'X', userId: 1 });
      expect(count).toBe(0);
    });
  });

  describe('releaseAllLocksForUser', () => {
    it('returns list of released locks', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { entity_type: 'node', entity_id: 1, model_name: 'M1' },
          { entity_type: 'edge', entity_id: 2, model_name: 'M1' },
        ],
      });

      const released = await releaseAllLocksForUser(1);
      expect(released).toHaveLength(2);
      expect(released[0]).toMatchObject({ entityType: 'node', entityId: 1, modelName: 'M1' });
    });
  });

  describe('checkLockOwnership', () => {
    const params = { entityType: 'node', entityId: 1, modelName: 'M1', userId: 1 };

    it('returns owned=true for valid owner', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({ rows: [{ user_id: 1, expires_at: new Date(Date.now() + 30000).toISOString() }] });

      const result = await checkLockOwnership(params);
      expect(result).toEqual({ owned: true });
    });

    it('returns lock_required when no lock exists', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await checkLockOwnership(params);
      expect(result).toEqual({ owned: false, reason: 'lock_required' });
    });

    it('returns lock_expired when lock is past TTL', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({ rows: [{ user_id: 1, expires_at: new Date(Date.now() - 5000).toISOString() }] });

      const result = await checkLockOwnership(params);
      expect(result).toEqual({ owned: false, reason: 'lock_expired' });
    });

    it('returns not_owner when another user holds the lock', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({ rows: [{ user_id: 99, expires_at: new Date(Date.now() + 30000).toISOString() }] });

      const result = await checkLockOwnership(params);
      expect(result).toEqual({ owned: false, reason: 'not_owner' });
    });
  });

  describe('cleanupExpiredLocks', () => {
    it('returns released locks from expired rows', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ entity_type: 'node', entity_id: 5, model_name: 'M1' }],
      });

      const released = await cleanupExpiredLocks();
      expect(released).toHaveLength(1);
      expect(released[0]).toMatchObject({ entityType: 'node', entityId: 5, modelName: 'M1' });
    });
  });
});
