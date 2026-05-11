jest.mock('../../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock('../../../src/services/permissions/model-permissions.service', () => ({
  getModelRole: jest.fn(),
}));

import type { Request, Response, NextFunction } from 'express';
import { requireModelRole } from '../../../src/middlewares/model-permission.middleware';
import { getModelRole } from '../../../src/services/permissions/model-permissions.service';

const mockGetModelRole = getModelRole as jest.Mock;

// Builds a minimal mock response with chained status/json.
const mockRes = () => {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe('requireModelRole', () => {
  it('returns 401 when no user is attached to the request', async () => {
    const req = { params: { name: 'ModelA' }, body: {} } as unknown as Request;
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;

    await requireModelRole(['viewer'])(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() immediately for global Admin without touching DB', async () => {
    const req = {
      params: { name: 'ModelA' },
      body: {},
      user: { id: 1, email: 'admin@x.com', role: 'Admin' },
    } as unknown as Request;
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;

    await requireModelRole(['editor'])(req, res, next);

    expect(mockGetModelRole).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when the user has no model_permissions record', async () => {
    mockGetModelRole.mockResolvedValueOnce(null);
    // requireModelRole checks if model exists: model DOES exist → 403 "no access" (not bootstrap)
    const { default: pool } = await import('../../../src/config/database');
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const req = {
      params: { name: 'ModelA' },
      body: {},
      user: { id: 2, email: 'editor@x.com', role: 'Editor' },
    } as unknown as Request;
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;

    await requireModelRole(['viewer', 'editor', 'reviewer'])(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when the model role does not satisfy the required set', async () => {
    // User has 'viewer' role but endpoint requires 'editor'.
    mockGetModelRole.mockResolvedValueOnce('viewer');
    const req = {
      params: { name: 'ModelA' },
      body: {},
      user: { id: 2, email: 'viewer@x.com', role: 'Viewer' },
    } as unknown as Request;
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;

    await requireModelRole(['editor'])(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when the model role matches one of the required roles', async () => {
    mockGetModelRole.mockResolvedValueOnce('editor');
    const req = {
      params: { name: 'ModelA' },
      body: {},
      user: { id: 2, email: 'editor@x.com', role: 'Editor' },
    } as unknown as Request;
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;

    await requireModelRole(['editor'])(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((res.status as jest.Mock)).not.toHaveBeenCalled();
  });

  it('reads stm_name from req.body when params.name is absent (POST /save scenario)', async () => {
    mockGetModelRole.mockResolvedValueOnce('editor');
    const req = {
      params: {},
      body: { stm_name: 'ModelB' },
      user: { id: 3, email: 'ed@x.com', role: 'Editor' },
    } as unknown as Request;
    const res = mockRes();
    const next = jest.fn() as unknown as NextFunction;

    await requireModelRole(['editor'])(req, res, next);

    expect(mockGetModelRole).toHaveBeenCalledWith('ModelB', 'ed@x.com');
    expect(next).toHaveBeenCalled();
  });

  it('reviewer role is allowed on read endpoints but denied on write endpoints', async () => {
    // reviewer on a read endpoint → allowed
    mockGetModelRole.mockResolvedValueOnce('reviewer');
    const readReq = {
      params: { name: 'ModelA' },
      body: {},
      user: { id: 4, email: 'rev@x.com', role: 'Viewer' },
    } as unknown as Request;
    const readRes = mockRes();
    const readNext = jest.fn() as unknown as NextFunction;
    await requireModelRole(['viewer', 'editor', 'reviewer'])(readReq, readRes, readNext);
    expect(readNext).toHaveBeenCalled();

    // reviewer on a write endpoint → denied
    mockGetModelRole.mockResolvedValueOnce('reviewer');
    const writeReq = {
      params: { name: 'ModelA' },
      body: {},
      user: { id: 4, email: 'rev@x.com', role: 'Viewer' },
    } as unknown as Request;
    const writeRes = mockRes();
    const writeNext = jest.fn() as unknown as NextFunction;
    await requireModelRole(['editor'])(writeReq, writeRes, writeNext);
    expect((writeRes.status as jest.Mock)).toHaveBeenCalledWith(403);
    expect(writeNext).not.toHaveBeenCalled();
  });
});
