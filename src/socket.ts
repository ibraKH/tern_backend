import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

let ioInstance: SocketIOServer | undefined;

export function initIo(server: HttpServer, frontendUrl: string): SocketIOServer {
  if (ioInstance) {
    const existingServer = (ioInstance as any).httpServer as HttpServer | undefined;
    if (existingServer === server) return ioInstance;

    // Avoid leaking listeners/sockets on accidental double-initialization.
    ioInstance.close();
    ioInstance = undefined;
  }

  const allowedOrigins = [
    frontendUrl,
    process.env.PRODUCTION_URL,
    'http://localhost:5173',
    'http://localhost:3000',
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
    const value = (real as any)[prop];
    return typeof value === 'function' ? value.bind(real) : value;
  },
  set(_target, prop, value) {
    (getIo() as any)[prop] = value;
    return true;
  },
}) as SocketIOServer;
