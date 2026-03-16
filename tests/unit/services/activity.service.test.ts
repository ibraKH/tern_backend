jest.mock('../../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import pool from '../../../src/config/database';
import { logActivity, getRecentActivity } from '../../../src/services/collab/activity.service';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('logActivity', () => {
  it('inserts a row when model exists', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rows: [] });

    await logActivity({ modelName: 'Forest', userId: 1, action: 'node_added' });

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect((pool.query as jest.Mock).mock.calls[1][0]).toContain('INSERT INTO collab_activity');
    expect((pool.query as jest.Mock).mock.calls[1][1]).toEqual([7, 1, 'node_added', undefined, undefined, undefined]);
  });

  it('is a no-op and does not throw when model not found', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    await expect(
      logActivity({ modelName: 'Unknown', userId: 1, action: 'node_added' })
    ).resolves.toBeUndefined();

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('does not throw when DB insert throws', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockRejectedValueOnce(new Error('DB error'));

    await expect(
      logActivity({ modelName: 'Forest', userId: 1, action: 'node_added' })
    ).resolves.toBeUndefined();
  });

  it('passes entityType, entityId, and detail to INSERT', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 3 }] })
      .mockResolvedValueOnce({ rows: [] });

    await logActivity({
      modelName: 'X',
      userId: 2,
      action: 'edge_edited',
      entityType: 'edge',
      entityId: 99,
      detail: { name: 'E1' },
    });

    const params = (pool.query as jest.Mock).mock.calls[1][1] as unknown[];
    expect(params[3]).toBe('edge');
    expect(params[4]).toBe(99);
    expect(params[5]).toEqual({ name: 'E1' });
  });
});

describe('getRecentActivity', () => {
  it('returns empty array when model not found', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const result = await getRecentActivity('NoModel');
    expect(result).toEqual([]);
  });

  it('returns rows in correct ActivityEntry shape', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          action: 'node_added',
          entityType: 'node',
          entityId: 10,
          detail: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          userId: 2,
          userEmail: 'alice@example.com',
        }],
      });

    const result = await getRecentActivity('Forest');
    expect(result[0]).toEqual({
      id: 1,
      action: 'node_added',
      entityType: 'node',
      entityId: 10,
      detail: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      user: { id: 2, email: 'alice@example.com' },
    });
  });

  it('defaults limit to 20 when not provided', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    await getRecentActivity('Forest');

    const params = (pool.query as jest.Mock).mock.calls[1][1] as unknown[];
    expect(params[1]).toBe(20);
  });

  it('clamps limit to 100 when over 100 is passed', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    await getRecentActivity('Forest', 500);

    const params = (pool.query as jest.Mock).mock.calls[1][1] as unknown[];
    expect(params[1]).toBe(100);
  });

  it('falls back to 20 when limit is 0 or negative', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    await getRecentActivity('Forest', 0);

    const params = (pool.query as jest.Mock).mock.calls[1][1] as unknown[];
    expect(params[1]).toBe(20);
  });
});
