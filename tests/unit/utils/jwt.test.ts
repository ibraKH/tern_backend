import { signToken as signToken, verifyToken } from "../../../src/utils/jwt";

describe("utils/jwt", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, JWT_SECRET: "test-secret", JWT_EXPIRES: "1h" };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("sign() creates a token that verifyToken() decodes", () => {
    const token = signToken({ uid: 1, email: "a@b.com", role: "author" });
    const payload = verifyToken(token);
    expect(payload.uid).toBe(1);
    expect(payload.email).toBe("a@b.com");
    expect(payload.role).toBe("author");
  });

  it("verifyToken() throws on bad token", () => {
    expect(() => verifyToken("not.a.jwt")).toThrow();
  });
});