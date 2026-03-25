import type { Socket } from 'socket.io';

import { verifyToken, type JwtPayload } from '../utils/jwt';

export type SocketAuthedUser = Pick<JwtPayload, 'uid' | 'email' | 'role'>;

export type CollabSocketData = { user?: SocketAuthedUser };
export type CollabSocket = Socket;

function extractTokenFromAuthorizationHeader(header: string | string[] | undefined): string | undefined {
  if (!header) return undefined;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;

  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) return trimmed.slice(7).trim() || undefined;
  return undefined;
}

function extractToken(socket: Socket): string | undefined {
  // Prefer handshake.auth.token because most Socket.IO clients send credentials there.
  // Keep Authorization fallback so proxies and REST-style callers remain compatible.
  const authToken = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
  if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();

  return extractTokenFromAuthorizationHeader(socket.handshake.headers.authorization);
}

export function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): void {
  const data = socket.data as CollabSocketData;

  // Defensive: avoid leaking a stale user from any previous assignment.
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

    // Store minimal identity in socket.data to avoid re-verifying JWT per event.
    // Keep fields aligned with REST authorization context only.
    const user: SocketAuthedUser = {
      uid: payload.uid,
      email: payload.email,
      role: payload.role,
    };

    data.user = user;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
}
