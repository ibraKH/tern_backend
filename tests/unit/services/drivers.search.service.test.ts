import { searchDrivers, getSubDrivers } from '../../../src/services/drivers/search.service';
import pool from '../../../src/config/database';

jest.mock('../../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

const mockQuery = pool.query as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('searchDrivers()', () => {
  it('returns matching drivers ordered by name', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'Fire regime', description: 'Altered fire', driver_group: 'Disturbance' },
        { id: 2, name: 'Fire suppression', description: null, driver_group: null },
      ],
    });

    const results = await searchDrivers('fire');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ILIKE'),
      ['%fire%', 20],
    );
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Fire regime');
  });

  it('returns empty array when no drivers match', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const results = await searchDrivers('zzznomatch');

    expect(results).toEqual([]);
  });

  it('respects a custom limit parameter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchDrivers('rain', 5);

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['%rain%', 5]);
  });
});

describe('getSubDrivers()', () => {
  it('returns sub-drivers for an existing driver', async () => {
    // First query: parent existence check
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    // Second query: sub-drivers fetch
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 10, driver_type: 'direct', driver_description: 'Grazing', management_driver_id: 3 },
      ],
    });

    const results = await getSubDrivers(3);

    expect(results).toHaveLength(1);
    expect(results[0].management_driver_id).toBe(3);
  });

  it('returns empty array when driver exists but has no sub-drivers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] }); // parent exists
    mockQuery.mockResolvedValueOnce({ rows: [] });           // no sub-drivers

    const results = await getSubDrivers(7);

    expect(results).toEqual([]);
  });

  it('throws a 404-tagged error when driver ID does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // parent not found

    await expect(getSubDrivers(999)).rejects.toMatchObject({
      status: 404,
      message: 'Driver not found',
    });
    // Should not make a second query after the 404
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
