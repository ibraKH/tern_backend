import type { Server } from 'socket.io';

import { joinRoom, leaveRoom, getRoom } from './roomManager';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function registerCollabHandlers(io: Server): void {
  io.on('connection', (socket) => {
    socket.on('room:join', (payload: unknown) => {
      const modelName = (payload as { modelName?: unknown } | undefined)?.modelName;

      if (!isNonEmptyString(modelName)) {
        socket.emit('error:validation', {
          message: 'modelName must be a non-empty string',
        });
        return;
      }

      const user = joinRoom(io, socket, modelName);
      const room = getRoom(modelName);
      const users = room ? Array.from(room.users.values()) : [];

      // Sync presence to the joiner only.
      socket.emit('presence:sync', { users });

      // Notify others in the room about the new/updated user.
      socket.to(modelName).emit('presence:join', { user });
    });

    socket.on('disconnecting', () => {
      const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);

      for (const modelName of rooms) {
        const left = leaveRoom(io, socket, modelName);
        if (left) {
          socket.to(modelName).emit('presence:leave', { userId: left.userId });
        }
      }
    });
  });
}
