const loadJwt = () => require("../../../src/utils/jwt");

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
    const { signToken, verifyToken } = loadJwt();
    const token = signToken({ uid: 1, email: "a@b.com", role: "Editor" });
    const payload = verifyToken(token);
    expect(payload.uid).toBe(1);
    expect(payload.email).toBe("a@b.com");
    expect(payload.role).toBe("Editor");
  });

  it("verifyToken() throws on bad token", () => {
    const { verifyToken } = loadJwt();
    expect(() => verifyToken("not.a.jwt")).toThrow();
  });
});