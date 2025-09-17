import { hash, verify } from "../../../src/utils/hash";

jest.mock("bcrypt", () => ({
  hash: jest.fn(async (input: string) => `hashed:${input}`),
  compare: jest.fn(async (input: string, digest: string) => digest === `hashed:${input}`),
}));

describe("utils/hash", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, BCRYPT_PEPPER: "pepper", BCRYPT_SALT_ROUNDS: "4" };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("hash() returns a digest string", async () => {
    const out = await hash("secret");
    expect(typeof out).toBe("string");
    expect(out.startsWith("hashed:")).toBe(true);
  });

  it("verify() true when digest matches", async () => {
    const digest = await hash("secret");
    await expect(verify("secret", digest)).resolves.toBe(true);
  });

  it("verify() false when digest does not match", async () => {
    const digest = await hash("secret");
    await expect(verify("wrong", digest)).resolves.toBe(false);
  });
});