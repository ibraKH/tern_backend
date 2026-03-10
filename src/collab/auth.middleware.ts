import type { Socket } from 'socket.io';
import type { DefaultEventsMap } from 'socket.io/dist/typed-events';
import type { ExtendedError } from 'socket.io/dist/namespace';

import { verifyToken, type JwtPayload } from '../utils/jwt';

export type SocketAuthedUser = Pick<JwtPayload, 'uid' | 'email' | 'role'>;

export type CollabSocketData = { user?: SocketAuthedUser };
export type CollabSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, CollabSocketData>;

function extractTokenFromAuthorizationHeader(header: string | string[] | undefined): string | undefined {
  if (!header) return undefined;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;

  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) return trimmed.slice(7).trim() || undefined;
  return undefined;
}

function extractToken(socket: CollabSocket): string | undefined {
  const authToken = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
  if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();

  return extractTokenFromAuthorizationHeader(socket.handshake.headers.authorization);
}

export function socketAuthMiddleware(socket: CollabSocket, next: (err?: ExtendedError) => void): void {
  // Defensive: avoid leaking a stale user from any previous assignment.
  if (Object.prototype.hasOwnProperty.call(socket.data, 'user')) {
    delete socket.data.user;
  }

  const token = extractToken(socket);
  if (!token) {
    next(new Error('Unauthorized'));
    return;
  }

  try {
    const payload = verifyToken(token) as JwtPayload;

    const user: SocketAuthedUser = {
      uid: payload.uid,
      email: payload.email,
      role: payload.role,
    };

    socket.data.user = user;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
}
