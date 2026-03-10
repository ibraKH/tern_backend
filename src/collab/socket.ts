import type { Server } from 'socket.io';

import { joinRoom, leaveRoom, getRoom } from './roomManager';
import type { SocketAuthedUser } from './auth.middleware';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

type CursorMovePayload = { x: number; y: number; modelName: string };
type ViewportUpdatePayload = { x: number; y: number; zoom: number; modelName: string };

type ThrottleKey = string;
type PendingBroadcast = {
  timer: NodeJS.Timeout;
  lastPayload: unknown;
  socketId: string;
};

function makeThrottleKey(event: 'cursor:move' | 'viewport:update', modelName: string, userId: number): ThrottleKey {
  return `${event}::${modelName}::${userId}`;
}

function getSocketUser(socket: any): SocketAuthedUser | undefined {
  return (socket?.data as { user?: SocketAuthedUser } | undefined)?.user;
}

export function registerCollabHandlers(io: Server): void {
  const pending = new Map<ThrottleKey, PendingBroadcast>();

  io.on('connection', (socket) => {
    const isCurrentRoomSocket = (modelName: string, userId: number): { color: string } | undefined => {
      if (!socket.rooms.has(modelName)) return undefined;
      const room = getRoom(modelName);
      if (!room) return undefined;
      const entry = room.users.get(String(userId));
      if (!entry) return undefined;
      if (entry.socketId !== socket.id) return undefined;
      return { color: entry.color };
    };

    const scheduleBroadcast = (
      event: 'cursor:move' | 'viewport:update',
      modelName: string,
      userId: number,
      socketId: string,
      payload: unknown,
      build: (payload: unknown) => unknown
    ) => {
      const key = makeThrottleKey(event, modelName, userId);
      const existing = pending.get(key);

      if (existing) {
        existing.lastPayload = payload;
        existing.socketId = socketId;
        return;
      }

      const timer = setTimeout(() => {
        const entry = pending.get(key);
        if (!entry) return;

        pending.delete(key);

        const sender = io.sockets.sockets.get(entry.socketId);
        if (!sender) return;

        sender.to(modelName).emit(event, build(entry.lastPayload));
      }, 50);

      pending.set(key, {
        timer,
        lastPayload: payload,
        socketId,
      });
    };

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

    socket.on('cursor:move', (payload: unknown) => {
      const modelName = (payload as Partial<CursorMovePayload> | undefined)?.modelName;
      const x = (payload as Partial<CursorMovePayload> | undefined)?.x;
      const y = (payload as Partial<CursorMovePayload> | undefined)?.y;

      if (!isNonEmptyString(modelName) || !isFiniteNumber(x) || !isFiniteNumber(y)) {
        socket.emit('error:validation', {
          message: 'cursor:move requires { modelName: non-empty string, x: finite number, y: finite number }',
        });
        return;
      }

      const user = getSocketUser(socket);
      if (!user) return;

      const membership = isCurrentRoomSocket(modelName, user.uid);
      if (!membership) return;

      scheduleBroadcast(
        'cursor:move',
        modelName,
        user.uid,
        socket.id,
        { x, y },
        (p) => {
          const last = p as { x: number; y: number };
          return { userId: user.uid, color: membership.color, x: last.x, y: last.y };
        }
      );
    });

    socket.on('viewport:update', (payload: unknown) => {
      const modelName = (payload as Partial<ViewportUpdatePayload> | undefined)?.modelName;
      const x = (payload as Partial<ViewportUpdatePayload> | undefined)?.x;
      const y = (payload as Partial<ViewportUpdatePayload> | undefined)?.y;
      const zoom = (payload as Partial<ViewportUpdatePayload> | undefined)?.zoom;

      if (!isNonEmptyString(modelName) || !isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom)) {
        socket.emit('error:validation', {
          message: 'viewport:update requires { modelName: non-empty string, x: finite number, y: finite number, zoom: finite number }',
        });
        return;
      }

      const user = getSocketUser(socket);
      if (!user) return;

      const membership = isCurrentRoomSocket(modelName, user.uid);
      if (!membership) return;

      scheduleBroadcast(
        'viewport:update',
        modelName,
        user.uid,
        socket.id,
        { x, y, zoom },
        (p) => {
          const last = p as { x: number; y: number; zoom: number };
          return { userId: user.uid, x: last.x, y: last.y, zoom: last.zoom };
        }
      );
    });

    socket.on('disconnecting', () => {
      const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);

      for (const modelName of rooms) {
        const left = leaveRoom(io, socket, modelName);
        if (left) {
          socket.to(modelName).emit('presence:leave', { userId: left.userId });
        }
      }

      // Cleanup pending throttled broadcasts for this socket/user.
      const currentUser = getSocketUser(socket);
      if (currentUser) {
        for (const modelName of rooms) {
          for (const event of ['cursor:move', 'viewport:update'] as const) {
            const key = makeThrottleKey(event, modelName, currentUser.uid);
            const entry = pending.get(key);
            if (entry) {
              clearTimeout(entry.timer);
              pending.delete(key);
            }
          }
        }
      }
    });
  });
}
