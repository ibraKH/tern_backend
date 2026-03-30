import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { PRODUCTION_URL } from './config/env';

let ioInstance: SocketIOServer | undefined;
let boundServer: HttpServer | undefined;

export function initIo(server: HttpServer, frontendUrl: string): SocketIOServer {
  if (ioInstance) {
    if (boundServer === server) return ioInstance;

    // Avoid leaking listeners/sockets on accidental double-initialization.
    ioInstance.close();
    ioInstance = undefined;
    boundServer = undefined;
  }

  const allowedOrigins = [
    frontendUrl,
    PRODUCTION_URL,
    ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://localhost:3000'] : []),
  ].filter((value): value is string => Boolean(value));

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
      '[socket] Socket.IO has not been initialized yet. Call initIo(server, FRONTEND_URL) during server startup.'
    );
  }

  return ioInstance;
}

// Safe, importable Socket.IO handle.
// Accessing properties before initIo() will throw a descriptive error.
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
