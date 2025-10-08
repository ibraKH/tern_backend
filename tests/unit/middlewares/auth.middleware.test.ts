jest.mock("../../../src/config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("../../../src/utils/jwt", () => ({
  verifyToken: jest.fn(),
}));

import { requireAuth } from "../../../src/middlewares/auth.middleware";
import pool from "../../../src/config/database";
import { verifyToken } from "../../../src/utils/jwt";
import type { User } from "../../../src/types/auth.types";
import type { Request, Response, NextFunction } from 'express';

type HeaderFn = (name: string) => string | undefined;
interface BasicRequest { header: HeaderFn; user?: User; }
interface MockResponse {
  status: jest.MockedFunction<(code: number) => MockResponse>;
  json: jest.MockedFunction<(body: unknown) => MockResponse>;
}
const mockRes = (): MockResponse => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as MockResponse;
  (res.status as unknown as jest.Mock).mockReturnValue(res);
  (res.json as unknown as jest.Mock).mockReturnValue(res);
  return res;
};

const invoke = (req: BasicRequest, res: MockResponse, next: jest.Mock) =>
  requireAuth(req as unknown as Request, res as unknown as Response, next as unknown as NextFunction);

describe("middlewares/requireAuth", () => {
  it("calls next() when token is valid", async () => {
    (verifyToken as jest.Mock).mockReturnValue({ uid: 1, email: "a@b.com" });
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [{ id: 1, email: "a@b.com", role: "Editor", contributor_id: null }],
    });

  const req: BasicRequest = { header: () => "Bearer valid.jwt.token" };
    const res = mockRes();
    const next = jest.fn();

  await invoke(req, res, next);

    expect(req.user).toEqual({
    id: 1,
    email: "a@b.com",
    role: "Editor",
    contributor_id: null,
    });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("401 when missing token", async () => {
  const req: BasicRequest = { header: () => undefined };
    const res = mockRes();
    const next = jest.fn();

  await invoke(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing token" });
    expect(next).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("401 when invalid/expired token", async () => {
    (verifyToken as jest.Mock).mockImplementation(() => {
      throw new Error("bad token");
    });

  const req: BasicRequest = { header: () => "Bearer bad.jwt" };
    const res = mockRes();
    const next = jest.fn();

  await invoke(req, res, next);

    expect(pool.query).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid or expired token" });
    expect(next).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("401 when token is valid but user not found in DB", async () => {
    (verifyToken as jest.Mock).mockReturnValue({ uid: 999 });
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

  const req: BasicRequest = { header: () => "Bearer valid.jwt.token" };
    const res = mockRes();
    const next = jest.fn();

  await invoke(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "User associated with this token does not exist",
    });
    expect(next).not.toHaveBeenCalled();
  });
});
