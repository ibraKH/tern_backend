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
import {
  createUser,
  getUserByEmail,
  authenticate,
  createVerificationToken,
  consumeVerificationToken,
} from "../../../src/services/auth.service";
import {
  AuthUnverifiedError,
  AuthTokenInvalidError,
  AuthTokenExpiredError,
} from "../../../src/errors";

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

  // ─── createUser ────────────────────────────────────────────────────────────

  describe("createUser()", () => {
    it("inserts user, links contributor, and returns final row", async () => {
      client.query
        .mockResolvedValueOnce(undefined)                        // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })           // INSERT auth_users
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })          // INSERT contributors
        .mockResolvedValueOnce(undefined)                        // UPDATE contributor_id
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            email: "t@e.com",
            password_hash: "h:secret",
            role: "Editor",
            contributor_id: 10,
            is_verified: false,
          }],
        })                                                       // SELECT final user
        .mockResolvedValueOnce(undefined);                       // COMMIT

      const user = await createUser({
        email: "t@e.com",
        password: "secret",
        name: "Test User",
      });

      expect(hash).toHaveBeenCalledWith("secret");
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO auth_users"),
        ["t@e.com", "h:secret", "Viewer"]
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
        expect.stringContaining("SELECT id, email, password_hash, role, contributor_id, is_verified"),
        [1]
      );
      expect(user).toEqual({
        id: 1,
        email: "t@e.com",
        password_hash: "h:secret",
        role: "Editor",
        contributor_id: 10,
        is_verified: false,
      });
    });
  });

  // ─── getUserByEmail ─────────────────────────────────────────────────────────

  describe("getUserByEmail()", () => {
    it("returns user when found", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 9, email: "x@y.com", password_hash: "h:pw", role: "Admin", contributor_id: 5, is_verified: true }],
      });

      const u = await getUserByEmail("x@y.com");
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("FROM auth_users"),
        ["x@y.com"]
      );
      expect(u?.id).toBe(9);
      expect(u?.is_verified).toBe(true);
    });

    it("returns null when not found", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
      const u = await getUserByEmail("none@z.com");
      expect(u).toBeNull();
    });
  });

  // ─── authenticate ───────────────────────────────────────────────────────────

  describe("authenticate()", () => {
    it("returns user when password correct and account verified", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 2, email: "a@b.com", password_hash: "h:secret", role: "Editor", contributor_id: null, is_verified: true }],
      });

      const u = await authenticate({ email: "a@b.com", password: "secret" });
      expect(verify).toHaveBeenCalledWith("secret", "h:secret");
      expect(u?.id).toBe(2);
    });

    it("returns null when password wrong", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 2, email: "a@b.com", password_hash: "h:secret", role: "Editor", contributor_id: null, is_verified: true }],
      });

      const u = await authenticate({ email: "a@b.com", password: "wrong" });
      expect(u).toBeNull();
    });

    it("returns null when user not found", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
      const u = await authenticate({ email: "none@b.com", password: "x" });
      expect(u).toBeNull();
    });

    it("throws AuthUnverifiedError when account is not verified", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 3, email: "unverified@b.com", password_hash: "h:secret", role: "Viewer", contributor_id: null, is_verified: false }],
      });

      await expect(authenticate({ email: "unverified@b.com", password: "secret" }))
        .rejects.toThrow(AuthUnverifiedError);
    });
  });

  // ─── createVerificationToken ────────────────────────────────────────────────

  describe("createVerificationToken()", () => {
    it("deletes old tokens, inserts new one, and returns a 64-char hex token", async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce(undefined)   // DELETE existing
        .mockResolvedValueOnce(undefined);  // INSERT new

      const rawToken = await createVerificationToken(42);

      expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM email_verification_tokens"),
        [42]
      );
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO email_verification_tokens"),
        expect.arrayContaining([42])
      );
    });

    it("stores a SHA-256 hash, not the raw token", async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const rawToken = await createVerificationToken(1);

      const insertCall = (pool.query as jest.Mock).mock.calls.find((c) =>
        (c[0] as string).includes("INSERT INTO email_verification_tokens")
      );
      const storedHash = insertCall?.[1]?.[1] as string;

      // stored hash must differ from raw token but be a valid hex string
      expect(storedHash).not.toBe(rawToken);
      expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ─── consumeVerificationToken ───────────────────────────────────────────────

  describe("consumeVerificationToken()", () => {
    it("marks user verified and returns user for a valid token", async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);

      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ user_id: 5, expires_at: futureDate }],
      });

      client.query
        .mockResolvedValueOnce(undefined)   // BEGIN
        .mockResolvedValueOnce(undefined)   // UPDATE is_verified = true
        .mockResolvedValueOnce(undefined)   // DELETE token
        .mockResolvedValueOnce({
          rows: [{
            id: 5,
            email: "v@test.com",
            password_hash: "h:pw",
            role: "Viewer",
            contributor_id: null,
            is_verified: true,
          }],
        })                                  // SELECT user
        .mockResolvedValueOnce(undefined);  // COMMIT

      const user = await consumeVerificationToken("somerawtoken");

      expect(user.id).toBe(5);
      expect(user.is_verified).toBe(true);
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE auth_users SET is_verified = true"),
        [5]
      );
    });

    it("throws AuthTokenInvalidError when token does not exist", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await expect(consumeVerificationToken("badtoken"))
        .rejects.toThrow(AuthTokenInvalidError);
    });

    it("throws AuthTokenExpiredError and deletes token when expired", async () => {
      const pastDate = new Date(Date.now() - 1000);

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ user_id: 5, expires_at: pastDate }] })  // SELECT
        .mockResolvedValueOnce(undefined);                                          // DELETE expired

      await expect(consumeVerificationToken("expiredtoken"))
        .rejects.toThrow(AuthTokenExpiredError);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM email_verification_tokens"),
        expect.anything()
      );
    });
  });
});
