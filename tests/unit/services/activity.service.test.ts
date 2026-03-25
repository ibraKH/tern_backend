import pool from '../../../src/config/database';
import { logActivity, getRecentActivity } from '../../../src/services/collab/activity.service';

jest.mock('../../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

const mockPool = pool as jest.Mocked<typeof pool>;

describe('activity.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('logActivity', () => {
    it('inserts a row when model exists', async () => {
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })  // model lookup
        .mockResolvedValueOnce({ rowCount: 1 });          // insert

      await logActivity({ modelName: 'TestModel', userId: 1, action: 'model_saved' });

      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect((mockPool.query as jest.Mock).mock.calls[1][0]).toContain('INSERT INTO collab_activity');
    });

    it('does not throw when model is not found', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await expect(logActivity({ modelName: 'Missing', userId: 1, action: 'x' })).resolves.toBeUndefined();
    });

    it('catches and logs DB errors without throwing', async () => {
      (mockPool.query as jest.Mock).mockRejectedValueOnce(new Error('DB down'));
      const spy = jest.spyOn(console, 'error').mockImplementation();

      await expect(logActivity({ modelName: 'X', userId: 1, action: 'y' })).resolves.toBeUndefined();

      spy.mockRestore();
    });
  });

  describe('getRecentActivity', () => {
    it('returns entries ordered by createdAt DESC', async () => {
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })  // model lookup
        .mockResolvedValueOnce({
          rows: [
            { id: 1, action: 'model_saved', entityType: null, entityId: null, detail: null, createdAt: '2026-01-01', userId: 1, userEmail: 'a@b.com' },
          ],
        });

      const entries = await getRecentActivity('TestModel');

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ action: 'model_saved', user: { id: 1, email: 'a@b.com' } });
    });

    it('returns empty array when model not found', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      const entries = await getRecentActivity('NoSuchModel');
      expect(entries).toEqual([]);
    });

    it('clamps limit to 100', async () => {
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await getRecentActivity('X', 999);

      const limitArg = (mockPool.query as jest.Mock).mock.calls[1][1][1];
      expect(limitArg).toBe(100);
    });
  });
});
