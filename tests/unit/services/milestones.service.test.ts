import pool from '../../../src/config/database';
import { createMilestone, listMilestones, getMilestone, deleteMilestone } from '../../../src/services/collab/milestones.service';
import * as showService from '../../../src/services/models/show.service';

jest.mock('../../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock('../../../src/services/models/show.service');

const mockQuery = pool.query as jest.Mock;
const mockGetModel = showService.getModelByName as jest.Mock;

describe('milestones.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('createMilestone', () => {
    it('creates a milestone with snapshot data', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] }) // model lookup
        .mockResolvedValueOnce({ rows: [{ id: 1, created_at: '2026-01-01' }] }) // insert
        .mockResolvedValueOnce({ rows: [{ email: 'creator@test.com' }] }); // author lookup

      mockGetModel.mockResolvedValueOnce({
        stm_name: 'M1', states: [{ state_id: 1, state_name: 'S1' }], transitions: [],
      });

      const result = await createMilestone({ modelName: 'M1', label: 'v1', createdBy: 1 });

      expect(result).toMatchObject({ id: 1, label: 'v1', createdByEmail: 'creator@test.com' });
    });

    it('throws 422 for empty model', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 10 }] });
      mockGetModel.mockResolvedValueOnce({ stm_name: 'M1', states: [], transitions: [] });

      await expect(
        createMilestone({ modelName: 'M1', label: 'v1', createdBy: 1 })
      ).rejects.toThrow('empty model');
    });

    it('throws 404 when model not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        createMilestone({ modelName: 'X', label: 'v1', createdBy: 1 })
      ).rejects.toThrow('Model not found');
    });
  });

  describe('listMilestones', () => {
    it('returns milestones without snapshot data', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 1, label: 'v1', created_by: 1, email: 'c@t.com', created_at: '2026-01-01',
          }],
        });

      const milestones = await listMilestones('M1');
      expect(milestones).toHaveLength(1);
      expect(milestones[0]).toMatchObject({ label: 'v1' });
      expect(milestones[0]).not.toHaveProperty('snapshot');
    });

    it('returns empty when model not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await listMilestones('X')).toEqual([]);
    });
  });

  describe('getMilestone', () => {
    it('returns milestone with snapshot', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 1, label: 'v1', created_by: 1, email: 'c@t.com',
            snapshot: { stm_name: 'M1' }, created_at: '2026-01-01',
          }],
        });

      const milestone = await getMilestone(1, 'M1');
      expect(milestone).toMatchObject({ id: 1, snapshot: { stm_name: 'M1' } });
    });

    it('returns null when milestone not found', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({ rows: [] });

      expect(await getMilestone(999, 'M1')).toBeNull();
    });
  });

  describe('deleteMilestone', () => {
    it('returns true when deleted', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      expect(await deleteMilestone(1, 'M1')).toBe(true);
    });

    it('returns false when not found', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({ rowCount: 0 });

      expect(await deleteMilestone(999, 'M1')).toBe(false);
    });
  });
});
