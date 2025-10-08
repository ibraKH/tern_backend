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

interface MockClient {
  query: jest.Mock;
  release: jest.Mock;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = (pool as any)._client as MockClient;

describe("services/auth.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createUser()", () => {
    it("inserts user, links contributor, and returns final row", async () => {
      client.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              email: "t@e.com",
              password_hash: "h:secret",
              role: "Editor",
              contributor_id: 10,
            },
          ],
        })
        .mockResolvedValueOnce(undefined);

      const user = await createUser({
        email: "t@e.com",
        password: "secret",
        role: "Editor",
        name: "Test User",
      });


      expect(hash).toHaveBeenCalledWith("secret");

      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO auth_users"),
        ["t@e.com", "h:secret", "Editor"]
      );

      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO contributors"),
        ["t@e.com", "Test User"]
      );

      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE auth_users SET contributor_id"),
        [10, 1]
      );

      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT id, email, password_hash, role, contributor_id"),
        [1]
      );

      expect(user).toEqual({
        id: 1,
        email: "t@e.com",
        password_hash: "h:secret",
        role: "Editor",
        contributor_id: 10,
      });
    });
  });

  describe("getUserByEmail()", () => {
    it("returns user when found", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 9, email: "x@y.com", password_hash: "h:pw", role: "Admin", contributor_id: 5 }],
      });

      const u = await getUserByEmail("x@y.com");
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("FROM auth_users"),
        ["x@y.com"]
      );
      expect(u?.id).toBe(9);
      expect(u?.role).toBe("Admin");
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
        rows: [{ id: 2, email: "a@b.com", password_hash: "h:secret", role: "Editor", contributor_id: null }],
      });

      const u = await authenticate({ email: "a@b.com", password: "secret" });
      expect(verify).toHaveBeenCalledWith("secret", "h:secret");
      expect(u?.id).toBe(2);
    });

    it("returns null when password wrong", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 2, email: "a@b.com", password_hash: "h:secret", role: "Editor", contributor_id: null }],
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