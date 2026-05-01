jest.mock('../../../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import pool from '../../../../src/config/database';
import {
  getModelRole,
  listModelPermissions,
  grantModelRole,
  revokeModelRole,
} from '../../../../src/services/permissions/model-permissions.service';

const mockQuery = pool.query as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('getModelRole', () => {
  it('returns the role when a record exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'editor' }] });
    const result = await getModelRole('ModelA', 'user@example.com');
    expect(result).toBe('editor');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT role FROM model_permissions'),
      ['ModelA', 'user@example.com'],
    );
  });

  it('returns null when no record exists and model is not a template', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ is_template: false }] });
    const result = await getModelRole('ModelA', 'nobody@example.com');
    expect(result).toBeNull();
  });

  it("returns 'viewer' when no record exists but model is a template", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ is_template: true }] });
    const result = await getModelRole('TemplateModel', 'nobody@example.com');
    expect(result).toBe('viewer');
  });
});

describe('listModelPermissions', () => {
  it('returns all permission records for a model', async () => {
    const rows = [
      { id: 1, stm_name: 'ModelA', user_email: 'a@b.com', role: 'viewer', granted_by: 'admin@b.com', granted_at: '2024-01-01' },
    ];
    mockQuery.mockResolvedValueOnce({ rows });
    const result = await listModelPermissions('ModelA');
    expect(result).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, stm_name'),
      ['ModelA'],
    );
  });

  it('returns an empty array when the model has no permissions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await listModelPermissions('Ghost');
    expect(result).toEqual([]);
  });
});

describe('grantModelRole', () => {
  it('issues an upsert with the correct parameters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await grantModelRole('ModelA', 'user@example.com', 'reviewer', 'admin@example.com');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      ['ModelA', 'user@example.com', 'reviewer', 'admin@example.com'],
    );
  });
});

describe('revokeModelRole', () => {
  it('issues a DELETE with the correct parameters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await revokeModelRole('ModelA', 'user@example.com');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM model_permissions'),
      ['ModelA', 'user@example.com'],
    );
  });
});
