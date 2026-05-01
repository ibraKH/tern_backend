import type { Socket } from 'socket.io';

import { verifyToken, type JwtPayload } from '../utils/jwt';

export type SocketAuthedUser = Pick<JwtPayload, 'uid' | 'email' | 'role'>;

export type CollabSocketData = { user?: SocketAuthedUser };

/**
 * Extract JWT from socket handshake — checks auth.token first, falls back to Authorization header.
 */
function extractToken(socket: Socket): string | undefined {
  const authToken = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
  if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();

  const header = socket.handshake.headers.authorization;
  if (!header) return undefined;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) return trimmed.slice(7).trim() || undefined;
  return undefined;
}

/**
 * Socket.IO middleware: verifies JWT and attaches user to socket.data.
 * Register via io.use(socketAuthMiddleware) before any event handlers.
 */
export function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): void {
  const data = socket.data as CollabSocketData;

  // Clear any stale user from a previous assignment.
  if (Object.prototype.hasOwnProperty.call(data, 'user')) {
    delete data.user;
  }

  const token = extractToken(socket);
  if (!token) {
    next(new Error('Unauthorized'));
    return;
  }

  try {
    const payload = verifyToken(token) as JwtPayload;
    data.user = { uid: payload.uid, email: payload.email, role: payload.role };
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
}
