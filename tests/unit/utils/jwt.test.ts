import * as jwtUtils from "../../../src/utils/jwt";

describe("utils/jwt", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, JWT_SECRET: "test-secret", JWT_EXPIRES: "1h" };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("sign() creates a token that verifyToken() decodes", () => {
  const token = jwtUtils.signToken({ uid: 1, email: "a@b.com", role: "Editor" });
  const payload = jwtUtils.verifyToken(token);
    expect(payload.uid).toBe(1);
    expect(payload.email).toBe("a@b.com");
    expect(payload.role).toBe("Editor");
  });

  it("verifyToken() throws on bad token", () => {
  expect(() => jwtUtils.verifyToken("not.a.jwt")).toThrow();
  });
});