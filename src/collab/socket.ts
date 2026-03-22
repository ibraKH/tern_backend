import type { Server, Socket } from 'socket.io';

import { joinRoom, leaveRoom, getRoom } from './roomManager';
import type { SocketAuthedUser } from './auth.middleware';
import { getRecentActivity } from '../services/collab/activity.service';

export const COLLAB_THROTTLE_MS = 50 as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

type CursorMovePayload = { x: number; y: number; modelName: string };
type ViewportUpdatePayload = { x: number; y: number; zoom: number; modelName: string };

type RoomKey = string;
type RoomLocatorPayload = { modelId?: number; modelName?: string };

type ThrottleKey = string;
type PendingBroadcast = {
  timer: NodeJS.Timeout;
  lastPayload: unknown;
  socketId: string;
};

function makeThrottleKey(event: 'cursor:move' | 'viewport:update', roomKey: RoomKey, userId: number): ThrottleKey {
  return `${event}::${roomKey}::${userId}`;
}

function getSocketUser(socket: Socket): SocketAuthedUser | undefined {
  return (socket.data as { user?: SocketAuthedUser } | undefined)?.user;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function resolveRoomKey(payload: unknown): { roomKey: RoomKey; modelName?: string } | { error: string } {
  const modelId = (payload as RoomLocatorPayload | undefined)?.modelId;
  const modelName = (payload as RoomLocatorPayload | undefined)?.modelName;

  if (isFiniteInteger(modelId) && modelId > 0) {
    return { roomKey: `model:${modelId}`, modelName: isNonEmptyString(modelName) ? modelName : undefined };
  }

  if (isNonEmptyString(modelName)) {
    return { roomKey: `name:${modelName}`, modelName };
  }

  return { error: 'Either modelId (positive integer) or modelName (non-empty string) is required' };
}

export function registerCollabHandlers(io: Server): void {
  const pending = new Map<ThrottleKey, PendingBroadcast>();

  io.on('connection', (socket) => {
    const isCurrentRoomSocket = (roomKey: RoomKey, userId: number): { color: string } | undefined => {
      if (!socket.rooms.has(roomKey)) return undefined;
      const room = getRoom(roomKey);
      if (!room) return undefined;
      const entry = room.users.get(String(userId));
      if (!entry) return undefined;
      if (room.socketIdByUserId.get(String(userId)) !== socket.id) return undefined;
      return { color: entry.color };
    };

    const scheduleBroadcast = (
      event: 'cursor:move' | 'viewport:update',
      roomKey: RoomKey,
      userId: number,
      socketId: string,
      payload: unknown,
      build: (payload: unknown) => unknown
    ) => {
      const key = makeThrottleKey(event, roomKey, userId);
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

        // Re-validate that this socket is still the active room member for this user.
        // This prevents stale sockets from broadcasting if the user reconnects within the throttle window.
        const room = getRoom(roomKey);
        const activeSocketId = room?.socketIdByUserId.get(String(userId));
        if (!activeSocketId || activeSocketId !== entry.socketId) return;

        const sender = io.sockets.sockets.get(entry.socketId);
        if (!sender) return;

        if (!sender.rooms.has(roomKey)) return;

        sender.to(roomKey).emit(event, build(entry.lastPayload));
      }, COLLAB_THROTTLE_MS);

      pending.set(key, {
        timer,
        lastPayload: payload,
        socketId,
      });
    };

    socket.on('room:join', (payload: unknown) => {
      const resolved = resolveRoomKey(payload);
      if ('error' in resolved) {
        socket.emit('error:validation', {
          message: resolved.error,
        });
        return;
      }

      const { roomKey, modelName } = resolved;

      void (async () => {
        const user = await joinRoom(io, socket, roomKey, modelName);
        const room = getRoom(roomKey);
        const users = room ? Array.from(room.users.values()) : [];

        // Sync presence to the joiner only.
        socket.emit('presence:sync', { users });

        // Send last 20 activity entries so the joiner has immediate context.
        // Wrapped in try-catch so a DB failure never prevents joining the room.
        if (modelName) {
          try {
            const activity = await getRecentActivity(modelName);
            socket.emit('activity:recent', { activity });
          } catch {
            socket.emit('activity:recent', { activity: [] });
          }
        }

        // Notify others in the room about the new/updated user.
        socket.to(roomKey).emit('presence:join', { user });
      })().catch(() => {
        socket.emit('error:validation', { message: 'failed to join room' });
      });
    });

    socket.on('cursor:move', (payload: unknown) => {
      const x = (payload as Partial<CursorMovePayload> | undefined)?.x;
      const y = (payload as Partial<CursorMovePayload> | undefined)?.y;

      const resolved = resolveRoomKey(payload);

      if ('error' in resolved || !isFiniteNumber(x) || !isFiniteNumber(y)) {
        socket.emit('error:validation', {
          message:
            'cursor:move requires { modelId: positive integer OR modelName: non-empty string, x: finite number, y: finite number }',
        });
        return;
      }

      const { roomKey } = resolved;

      const user = getSocketUser(socket);
      if (!user) return;

      const membership = isCurrentRoomSocket(roomKey, user.uid);
      if (!membership) return;

      scheduleBroadcast(
        'cursor:move',
        roomKey,
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
      const x = (payload as Partial<ViewportUpdatePayload> | undefined)?.x;
      const y = (payload as Partial<ViewportUpdatePayload> | undefined)?.y;
      const zoom = (payload as Partial<ViewportUpdatePayload> | undefined)?.zoom;

      const resolved = resolveRoomKey(payload);

      if ('error' in resolved || !isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom)) {
        socket.emit('error:validation', {
          message:
            'viewport:update requires { modelId: positive integer OR modelName: non-empty string, x: finite number, y: finite number, zoom: finite number }',
        });
        return;
      }

      const { roomKey } = resolved;

      const user = getSocketUser(socket);
      if (!user) return;

      const membership = isCurrentRoomSocket(roomKey, user.uid);
      if (!membership) return;

      scheduleBroadcast(
        'viewport:update',
        roomKey,
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
      void (async () => {
        const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);

        for (const roomKey of rooms) {
          const left = await leaveRoom(io, socket, roomKey);
          if (left) {
            socket.to(roomKey).emit('presence:leave', { userId: left.userId });
          }
        }

        // Cleanup pending throttled broadcasts for this socket/user.
        const currentUser = getSocketUser(socket);
        if (currentUser) {
          for (const roomKey of rooms) {
            for (const event of ['cursor:move', 'viewport:update'] as const) {
              const key = makeThrottleKey(event, roomKey, currentUser.uid);
              const entry = pending.get(key);
              if (entry) {
                clearTimeout(entry.timer);
                pending.delete(key);
              }
            }
          }
        }
      })().catch(() => {
        // best-effort cleanup
      });
    });
  });
}
