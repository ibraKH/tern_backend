import { requireAuth } from "../../../src/middlewares/auth.middleware";

jest.mock("../../../src/utils/jwt", () => ({
  verifyToken: jest.fn(),
}));

import { verifyToken } from "../../../src/utils/jwt";

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("middlewares/requireAuth", () => {
  it("calls next() when token is valid", () => {
    (verifyToken as jest.Mock).mockReturnValue({ uid: 1, email: "a@b.com", role: "author" });

    const req: any = { header: () => "Bearer valid.jwt.token" };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(verifyToken).toHaveBeenCalled();
    expect((req as any).user).toEqual({ uid: 1, email: "a@b.com", role: "author" });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("401 when missing token", () => {
    const req: any = { header: () => undefined };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing token" });
    expect(next).not.toHaveBeenCalled();
  });

  it("401 when invalid/expired token", () => {
    (verifyToken as jest.Mock).mockImplementation(() => {
      throw new Error("bad token");
    });

    const req: any = { header: () => "Bearer bad.jwt" };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid or expired token" });
    expect(next).not.toHaveBeenCalled();
  });
});
