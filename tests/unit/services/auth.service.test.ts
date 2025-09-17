jest.mock("../../../src/config/database", () => {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      connect: jest.fn(async () => client),
      query: jest.fn(),
      _client: client,
    },
  };
});

jest.mock("../../../src/utils/hash", () => ({
  hash: jest.fn(async (s: string) => `h:${s}`),
  verify: jest.fn(async (plain: string, digest: string) => digest === `h:${plain}`),
}));

import pool from "../../../src/config/database";
import { hash, verify } from "../../../src/utils/hash";
import { createUser, getUserByEmail, authenticate } from "../../../src/services/auth.service";

const client: any = (pool as any)._client;

describe("services/auth.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createUser()", () => {
    it("inserts user and returns row", async () => {
      client.query.mockResolvedValueOnce({
        rows: [{ id: 1, email: "t@e.com", password_hash: "h:secret", role: "author", contributor_id: null }],
      });

      const user = await createUser({ email: "t@e.com", password: "secret" });

      expect(hash).toHaveBeenCalledWith("secret");
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO auth_users"),
        ["t@e.com", "h:secret", undefined]
      );
      expect(user.email).toBe("t@e.com");
      expect(user.id).toBe(1);
    });
  });

  describe("getUserByEmail()", () => {
    it("returns user when found", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 9, email: "x@y.com", password_hash: "h:pw", role: "admin", contributor_id: 5 }],
      });

      const u = await getUserByEmail("x@y.com");
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("FROM auth_users"), ["x@y.com"]);
      expect(u?.id).toBe(9);
      expect(u?.role).toBe("admin");
    });

    it("returns null when not found", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
      const u = await getUserByEmail("none@z.com");
      expect(u).toBeNull();
    });
  });

  describe("authenticate()", () => {
    it("returns user when password correct", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 2, email: "a@b.com", password_hash: "h:secret", role: "author", contributor_id: null }],
      });

      const u = await authenticate({ email: "a@b.com", password: "secret" });
      expect(verify).toHaveBeenCalledWith("secret", "h:secret");
      expect(u?.id).toBe(2);
    });

    it("returns null when password wrong", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 2, email: "a@b.com", password_hash: "h:secret", role: "author", contributor_id: null }],
      });

      const u = await authenticate({ email: "a@b.com", password: "wrong" });
      expect(u).toBeNull();
    });

    it("returns null when user not found", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
      const u = await authenticate({ email: "none@b.com", password: "x" });
      expect(u).toBeNull();
    });
  });
});