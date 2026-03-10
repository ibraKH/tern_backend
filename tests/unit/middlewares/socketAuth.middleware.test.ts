import jwt from 'jsonwebtoken';

import { socketAuthMiddleware, type CollabSocket } from '../../../src/collab/auth.middleware';
import { signToken } from '../../../src/utils/jwt';

describe('collab/socketAuthMiddleware', () => {
  function makeSocket(overrides?: Partial<CollabSocket>): CollabSocket {
    const base = {
      handshake: {
        auth: {},
        headers: {},
      },
      data: {},
    };

    return { ...base, ...(overrides ?? {}) } as unknown as CollabSocket;
  }

  it('valid token -> next() called and socket.data.user populated', () => {
    const token = signToken({ uid: 42, email: 'u@example.com', role: 'Viewer' });
    const socket = makeSocket({
      handshake: { auth: { token }, headers: {} } as unknown as CollabSocket['handshake'],
    });

    const next = jest.fn<void, [Error?]>();

    socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user).toEqual({ uid: 42, email: 'u@example.com', role: 'Viewer' });
  });

  it('missing token -> next(Error) called and no user attached', () => {
    const socket = makeSocket();
    const next = jest.fn<void, [Error?]>();

    socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((next.mock.calls[0][0] as Error).message).toBe('Unauthorized');
    expect(socket.data.user).toBeUndefined();
  });

  it('expired token -> rejected same as missing', () => {
    const secret = process.env.JWT_SECRET as string;
    const issuer = process.env.JWT_ISSUER || 'tern-backend';
    const audience = process.env.JWT_AUDIENCE || 'tern-api';

    const expiredToken = jwt.sign(
      { uid: 1, email: 'a@b.com', role: 'Editor' },
      secret,
      { expiresIn: -10, issuer, audience }
    );

    const socket = makeSocket({
      handshake: { auth: { token: expiredToken }, headers: {} } as unknown as CollabSocket['handshake'],
    });

    const next = jest.fn<void, [Error?]>();
    socketAuthMiddleware(socket, next);

    expect((next.mock.calls[0][0] as Error).message).toBe('Unauthorized');
    expect(socket.data.user).toBeUndefined();
  });

  it('tampered token -> rejected same as missing', () => {
    const token = signToken({ uid: 1, email: 'a@b.com', role: 'Editor' });
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${parts[2].slice(-1) === 'a' ? 'b' : 'a'}`;

    const socket = makeSocket({
      handshake: { auth: { token: tampered }, headers: {} } as unknown as CollabSocket['handshake'],
    });

    const next = jest.fn<void, [Error?]>();
    socketAuthMiddleware(socket, next);

    expect((next.mock.calls[0][0] as Error).message).toBe('Unauthorized');
    expect(socket.data.user).toBeUndefined();
  });
});
