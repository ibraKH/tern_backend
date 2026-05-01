import { socketAuthMiddleware } from '../../../src/collab/auth.middleware';
import { signToken } from '../../../src/utils/jwt';

function createFakeSocket(auth?: Record<string, unknown>, headers?: Record<string, string>) {
  return {
    data: {},
    handshake: {
      auth: auth ?? {},
      headers: headers ?? {},
    },
  } as unknown as Parameters<typeof socketAuthMiddleware>[0];
}

describe('socketAuthMiddleware', () => {
  const validPayload = { uid: 1, email: 'test@example.com', role: 'Editor' as const };

  it('attaches user when token is in handshake auth', () => {
    const token = signToken(validPayload);
    const socket = createFakeSocket({ token });
    const next = jest.fn();

    socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user).toMatchObject({ uid: 1, email: 'test@example.com', role: 'Editor' });
  });

  it('attaches user when token is in Authorization header', () => {
    const token = signToken(validPayload);
    const socket = createFakeSocket({}, { authorization: `Bearer ${token}` });
    const next = jest.fn();

    socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user).toBeDefined();
  });

  it('rejects when no token is provided', () => {
    const socket = createFakeSocket();
    const next = jest.fn();

    socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect((next.mock.calls[0][0] as Error).message).toBe('Unauthorized');
    expect(socket.data.user).toBeUndefined();
  });

  it('rejects when token is invalid', () => {
    const socket = createFakeSocket({ token: 'invalid.jwt.token' });
    const next = jest.fn();

    socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(socket.data.user).toBeUndefined();
  });

  it('clears stale user data before verifying', () => {
    const token = signToken(validPayload);
    const socket = createFakeSocket({ token });
    // Simulate stale user from a previous attempt.
    (socket.data as Record<string, unknown>).user = { uid: 999, email: 'stale@x.com', role: 'Admin' };

    const next = jest.fn();
    socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user).toMatchObject({ uid: 1 });
  });
});
