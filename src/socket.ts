import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

export let io: SocketIOServer | undefined;

export function initIo(server: HttpServer, frontendUrl: string): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: frontendUrl,
      methods: ['GET', 'POST'],
      credentials: false,
    },
  });

  return io;
}

export function getIo(): SocketIOServer {
  if (!io) {
    throw new Error(
      '[socket] Socket.IO has not been initialized yet. Call initIo(server, FRONTEND_URL) during server startup.'
    );
  }

  return io;
}
