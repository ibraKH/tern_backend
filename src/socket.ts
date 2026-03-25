import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { PRODUCTION_URL } from './config/env';

let ioInstance: SocketIOServer | undefined;
let boundServer: HttpServer | undefined;

/**
 * Attach Socket.IO to an HTTP server with matching CORS policy.
 * Safe to call more than once with the same server — returns the cached instance.
 */
export function initIo(server: HttpServer, frontendUrl: string): SocketIOServer {
  if (ioInstance) {
    if (boundServer === server) return ioInstance;
    ioInstance.close();
    ioInstance = undefined;
    boundServer = undefined;
  }

  const allowedOrigins = [
    frontendUrl,
    PRODUCTION_URL,
    ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://localhost:3000'] : []),
  ].filter((v): v is string => Boolean(v));

  ioInstance = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ['GET', 'POST'],
      credentials: false,
    },
  });

  boundServer = server;
  return ioInstance;
}

export function getIo(): SocketIOServer {
  if (!ioInstance) {
    throw new Error(
      '[socket] Socket.IO not initialized. Call initIo(server, FRONTEND_URL) during startup.'
    );
  }
  return ioInstance;
}

// Proxy that lazily resolves to the initialized server — importable anywhere.
export const io: SocketIOServer = new Proxy({} as SocketIOServer, {
  get(_target, prop) {
    const real = getIo();
    const value = (real as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
  set(_target, prop, value) {
    (getIo() as unknown as Record<string | symbol, unknown>)[prop] = value;
    return true;
  },
}) as SocketIOServer;
