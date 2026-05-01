jest.mock("../../src/services/auth.service");
jest.mock("../../src/services/email.service", () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../src/services/collab/mentions.service", () => ({
  getPendingMentions: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../src/middlewares/rateLimit", () => ({
  limitSignup:              (_req: unknown, _res: unknown, next: () => void) => next(),
  limitLogin:               (_req: unknown, _res: unknown, next: () => void) => next(),
  limitResendVerification:  (_req: unknown, _res: unknown, next: () => void) => next(),
  limitModelsRead:          (_req: unknown, _res: unknown, next: () => void) => next(),
  limitModelsWrite:         (_req: unknown, _res: unknown, next: () => void) => next(),
  limitDriversRead:         (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from 'supertest';
import app from '../../src/app';
import * as authService from '../../src/services/auth.service';
import * as mentionsService from '../../src/services/collab/mentions.service';
import { ConflictError, AuthInvalidError, AuthUnverifiedError, AuthTokenInvalidError, AuthTokenExpiredError } from '../../src/errors';

const mockGetUserByEmail       = authService.getUserByEmail       as jest.Mock;
const mockCreateUser           = authService.createUser           as jest.Mock;
const mockAuthenticate         = authService.authenticate         as jest.Mock;
const mockCreateVerifToken     = authService.createVerificationToken as jest.Mock;
const mockConsumeVerifToken    = authService.consumeVerificationToken as jest.Mock;
const mockGetPendingMentions   = mentionsService.getPendingMentions as jest.Mock;

const verifiedUser = {
  id: 1,
  email: 'user@example.com',
  password_hash: 'h:Password1!',
  role: 'Viewer' as const,
  contributor_id: null,
  is_verified: true,
};

const signupBody = {
  name: 'Test User',
  email: 'user@example.com',
  password: 'Password1!',
};

// ─── health ──────────────────────────────────────────────────────────────────

describe('GET /auth/health', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/auth/health');
    expect(res.status).toBe(200);
  });
});

// ─── POST /auth/signup ────────────────────────────────────────────────────────

describe('POST /auth/signup', () => {
  it('creates account and returns 201 with message', async () => {
    mockGetUserByEmail.mockResolvedValueOnce(null);
    mockCreateUser.mockResolvedValueOnce(verifiedUser);
    mockCreateVerifToken.mockResolvedValueOnce('rawtoken123');

    const res = await request(app).post('/auth/signup').send(signupBody);

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/verification email sent/i);
    expect(res.body.token).toBeUndefined();
  });

  it('returns 409 when email already in use', async () => {
    mockGetUserByEmail.mockResolvedValueOnce(verifiedUser);

    const res = await request(app).post('/auth/signup').send(signupBody);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESOURCE_CONFLICT');
  });

  it('returns 400 when body is invalid', async () => {
    const res = await request(app).post('/auth/signup').send({ email: 'notanemail' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── POST /auth/verify ────────────────────────────────────────────────────────

describe('POST /auth/verify', () => {
  it('returns JWT and user on valid token', async () => {
    mockConsumeVerifToken.mockResolvedValueOnce(verifiedUser);

    const res = await request(app).post('/auth/verify').send({ token: 'validtoken' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toMatchObject({ id: 1, email: 'user@example.com', role: 'Viewer' });
  });

  it('returns 400 for an invalid token', async () => {
    mockConsumeVerifToken.mockRejectedValueOnce(new AuthTokenInvalidError());

    const res = await request(app).post('/auth/verify').send({ token: 'badtoken' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('returns 400 for an expired token', async () => {
    mockConsumeVerifToken.mockRejectedValueOnce(new AuthTokenExpiredError());

    const res = await request(app).post('/auth/verify').send({ token: 'expiredtoken' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('returns 400 when token field is missing', async () => {
    const res = await request(app).post('/auth/verify').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── POST /auth/resend-verification ──────────────────────────────────────────

describe('POST /auth/resend-verification', () => {
  it('returns 200 with generic message when account is unverified', async () => {
    mockGetUserByEmail.mockResolvedValueOnce({ ...verifiedUser, is_verified: false });
    mockCreateVerifToken.mockResolvedValueOnce('newtoken');

    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  it('returns same 200 response when email is not registered', async () => {
    mockGetUserByEmail.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'notregistered@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  it('returns same 200 response when account is already verified', async () => {
    mockGetUserByEmail.mockResolvedValueOnce(verifiedUser);

    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(200);
    expect(mockCreateVerifToken).not.toHaveBeenCalled();
  });

  it('returns 400 when email field is missing', async () => {
    const res = await request(app).post('/auth/resend-verification').send({});
    expect(res.status).toBe(400);
  });
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  it('returns JWT on valid credentials', async () => {
    mockAuthenticate.mockResolvedValueOnce(verifiedUser);
    mockGetPendingMentions.mockResolvedValueOnce([{ id: 10 }, { id: 11 }]);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'Password1!' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toMatchObject({ id: 1, email: 'user@example.com' });
    expect(res.body.pendingMentionCount).toBe(2);
    expect(mockGetPendingMentions).toHaveBeenCalledWith(1);
  });

  it('returns 401 on wrong credentials', async () => {
    mockAuthenticate.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'wrongpass' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('returns 403 when account is not verified', async () => {
    mockAuthenticate.mockRejectedValueOnce(new AuthUnverifiedError());

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'Password1!' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_UNVERIFIED');
  });

  it('returns 400 when body is invalid', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'notanemail' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
