import type { Server, Socket } from 'socket.io';

import { acquireLock, releaseAllLocksForSocket, releaseLock } from '../services/collab/locks.service';
import { getRoom, getUserColor, joinRoom, leaveRoom } from './roomManager';
import type { SocketAuthedUser } from './auth.middleware';
import { getRecentActivity } from '../services/collab/activity.service';
import { getEntityCoordinates } from '../services/collab/comments.service';
import pool from '../config/database';

export const COLLAB_THROTTLE_MS = 50 as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

type CursorMovePayload = { x: number; y: number; modelName: string };
type ViewportUpdatePayload = { x: number; y: number; zoom: number; modelName: string };
type LockPayload = {
  entityType: 'node' | 'edge';
  entityId: string | number;
  modelId?: number;
  modelName?: string;
};

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

export function resolveRoomKey(payload: unknown): { roomKey: RoomKey; modelName?: string } | { error: string } {
  const modelId = (payload as RoomLocatorPayload | undefined)?.modelId;
  const modelName = (payload as RoomLocatorPayload | undefined)?.modelName;

  if (isFiniteInteger(modelId) && modelId > 0) {
    return { roomKey: `model:${modelId}` };
  }

  if (isNonEmptyString(modelName)) {
    return { roomKey: `name:${modelName}`, modelName };
  }

  return { error: 'Either modelId (positive integer) or modelName (non-empty string) is required' };
}

function parseLockPayload(payload: unknown): LockPayload | { error: string } {
  const entityType = (payload as Partial<LockPayload> | undefined)?.entityType;
  const entityId = (payload as Partial<LockPayload> | undefined)?.entityId;
  const modelId = (payload as Partial<LockPayload> | undefined)?.modelId;
  const modelName = (payload as Partial<LockPayload> | undefined)?.modelName;

  if (entityType !== 'node' && entityType !== 'edge') {
    return { error: "entityType must be one of ['node', 'edge']" };
  }

  const resolved = resolveRoomKey({ modelId, modelName });
  if ('error' in resolved) {
    return { error: resolved.error };
  }

  if (!(isNonEmptyString(entityId) || (isFiniteInteger(entityId) && entityId > 0))) {
    return { error: 'entityId must be a non-empty string or positive integer' };
  }

  return {
    entityType,
    entityId,
    modelId: isFiniteInteger(modelId) && modelId > 0 ? modelId : undefined,
    modelName: resolved.modelName,
  };
}

function normalizeEntityId(entityId: string | number): number {
  return typeof entityId === 'number' ? entityId : Number.parseInt(entityId, 10);
}

function getModelIdFromRoomKey(roomKey: RoomKey): number | undefined {
  if (!roomKey.startsWith('model:')) return undefined;

  const parsed = Number.parseInt(roomKey.slice('model:'.length), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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

        socket.emit('presence:sync', { users });

        // Notify others in the room immediately — don't block on the DB query below.
        socket.to(roomKey).emit('presence:join', { user });

        // Send last 20 activity entries so the joiner has immediate context.
        // Wrapped in try-catch so a DB failure never prevents joining the room.
        // When modelName is missing (modelId-only join), resolve it from the DB.
        let resolvedModelName = modelName;
        if (!resolvedModelName) {
          const modelId = (payload as RoomLocatorPayload | undefined)?.modelId;
          if (isFiniteInteger(modelId) && modelId > 0) {
            try {
              const res = await pool.query<{ stm_name: string }>(
                'SELECT stm_name FROM stmmodel WHERE id = $1',
                [modelId],
              );
              if (res.rows.length > 0) {
                resolvedModelName = res.rows[0].stm_name;
              }
            } catch {
              // fall through — resolvedModelName stays undefined
            }
          }
        }

        try {
          if (resolvedModelName) {
            const activity = await getRecentActivity(resolvedModelName);
            socket.emit('activity:recent', { activity });
          } else {
            socket.emit('activity:recent', { activity: [] });
          }
        } catch {
          socket.emit('activity:recent', { activity: [] });
        }
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

    socket.on('lock:acquire', (payload: unknown) => {
      const parsed = parseLockPayload(payload);
      if ('error' in parsed) {
        socket.emit('error:validation', { message: parsed.error });
        return;
      }

      const resolvedRoom = resolveRoomKey(parsed);
      if ('error' in resolvedRoom) {
        socket.emit('error:validation', { message: resolvedRoom.error });
        return;
      }

      const roomKey = resolvedRoom.roomKey;
      const user = getSocketUser(socket);
      if (!user) return;

      const membership = isCurrentRoomSocket(roomKey, user.uid);
      if (!membership) {
        socket.emit('error:validation', { message: 'lock:acquire requires joining the model room first' });
        return;
      }

      const normalizedEntityId = normalizeEntityId(parsed.entityId);

      void acquireLock({
        entityType: parsed.entityType,
        entityId: normalizedEntityId,
        modelId: parsed.modelId,
        modelName: parsed.modelName,
        userId: user.uid,
      })
        .then((result) => {
          if (!result.success) {
            socket.emit('lock:denied', {
              entityType: parsed.entityType,
              entityId: normalizedEntityId,
              heldBy: result.heldBy,
            });
            return;
          }

          const color = getUserColor(user.uid, roomKey) ?? membership.color;
          socket.emit('lock:ack', {
            entityType: parsed.entityType,
            entityId: normalizedEntityId,
            userId: user.uid,
            color,
          });

          socket.to(roomKey).emit('lock:acquired', {
            entityType: parsed.entityType,
            entityId: normalizedEntityId,
            userId: user.uid,
            color,
          });
        })
        .catch(() => {
          socket.emit('error:validation', { message: 'failed to acquire lock' });
        });
    });

    socket.on('lock:release', (payload: unknown) => {
      const parsed = parseLockPayload(payload);
      if ('error' in parsed) {
        socket.emit('error:validation', { message: parsed.error });
        return;
      }

      const resolvedRoom = resolveRoomKey(parsed);
      if ('error' in resolvedRoom) {
        socket.emit('error:validation', { message: resolvedRoom.error });
        return;
      }

      const roomKey = resolvedRoom.roomKey;
      const user = getSocketUser(socket);
      if (!user) return;

      const membership = isCurrentRoomSocket(roomKey, user.uid);
      if (!membership) {
        socket.emit('error:validation', { message: 'lock:release requires joining the model room first' });
        return;
      }

      const normalizedEntityId = normalizeEntityId(parsed.entityId);

      void releaseLock({
        entityType: parsed.entityType,
        entityId: normalizedEntityId,
        modelId: parsed.modelId,
        modelName: parsed.modelName,
        userId: user.uid,
      })
        .then((deletedCount) => {
          if (deletedCount > 0) {
            io.to(roomKey).emit('lock:released', {
              entityType: parsed.entityType,
              entityId: normalizedEntityId,
            });
          }
        })
        .catch(() => {
          socket.emit('error:validation', { message: 'failed to release lock' });
        });
    });

    socket.on('lock:refresh', (payload: unknown) => {
      const parsed = parseLockPayload(payload);
      if ('error' in parsed) {
        socket.emit('error:validation', { message: parsed.error });
        return;
      }

      const resolvedRoom = resolveRoomKey(parsed);
      if ('error' in resolvedRoom) {
        socket.emit('error:validation', { message: resolvedRoom.error });
        return;
      }

      const roomKey = resolvedRoom.roomKey;
      const user = getSocketUser(socket);
      if (!user) return;

      const membership = isCurrentRoomSocket(roomKey, user.uid);
      if (!membership) {
        socket.emit('error:validation', { message: 'lock:refresh requires joining the model room first' });
        return;
      }

      const normalizedEntityId = normalizeEntityId(parsed.entityId);

      void acquireLock({
        entityType: parsed.entityType,
        entityId: normalizedEntityId,
        modelId: parsed.modelId,
        modelName: parsed.modelName,
        userId: user.uid,
      })
        .then((result) => {
          if (!result.success) {
            socket.emit('lock:denied', {
              entityType: parsed.entityType,
              entityId: normalizedEntityId,
              heldBy: result.heldBy,
            });
            return;
          }

          const color = getUserColor(user.uid, roomKey) ?? membership.color;
          socket.emit('lock:ack', {
            entityType: parsed.entityType,
            entityId: normalizedEntityId,
            userId: user.uid,
            color,
          });
        })
        .catch(() => {
          socket.emit('error:validation', { message: 'failed to refresh lock' });
        });
    });

    socket.on('viewport:navigate-to', (payload: unknown) => {
      const entityType = (payload as { entityType?: unknown } | undefined)?.entityType;
      const entityId = (payload as { entityId?: unknown } | undefined)?.entityId;
      const modelName = (payload as { modelName?: unknown } | undefined)?.modelName;

      if (!isNonEmptyString(modelName)) {
        socket.emit('error:validation', {
          message: 'viewport:navigate-to requires { modelName: non-empty string, entityType: string, entityId: number }',
        });
        return;
      }

      if (!isNonEmptyString(entityType) || !isFiniteInteger(entityId) || (entityId as number) <= 0) {
        socket.emit('error:validation', {
          message: 'viewport:navigate-to requires { modelName: non-empty string, entityType: string, entityId: positive integer }',
        });
        return;
      }

      void (async () => {
        try {
          const coords = await getEntityCoordinates(entityType as 'node' | 'edge', entityId as number);

          if (!coords) {
            socket.emit('error:not_found', {
              message: `${entityType} with id ${entityId} not found`,
            });
            return;
          }

          socket.emit('viewport:fly-to', coords);
        } catch (err) {
          console.error('[collab] viewport:navigate-to failed:', err);
          socket.emit('error:not_found', {
            message: `Failed to navigate to ${entityType}`,
          });
        }
      })().catch(() => {
        // best-effort error handling
      });
    });

    socket.on('disconnecting', () => {
      void (async () => {
        const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);
        const currentUser = getSocketUser(socket);

        if (currentUser) {
          const activeRoomKeys = rooms.filter((roomKey) => {
            const room = getRoom(roomKey);
            return room?.socketIdByUserId.get(String(currentUser.uid)) === socket.id;
          });

          const modelIds = activeRoomKeys
            .map((roomKey) => getModelIdFromRoomKey(roomKey))
            .filter((value): value is number => value !== undefined);
          const modelNames = activeRoomKeys
            .map((roomKey) => getRoom(roomKey)?.modelName ?? (roomKey.startsWith('name:') ? roomKey.slice('name:'.length) : undefined))
            .filter((value): value is string => isNonEmptyString(value));

          const releasedLocks = await releaseAllLocksForSocket(currentUser.uid, { modelIds, modelNames }).catch(() => []);
          for (const releasedLock of releasedLocks) {
            const targetRoomKeys = activeRoomKeys.filter((roomKey) => {
              const room = getRoom(roomKey);
              if (roomKey === `model:${releasedLock.modelId}`) return true;
              if (roomKey === `name:${releasedLock.modelName}`) return true;
              return room?.modelName === releasedLock.modelName;
            });

            for (const roomKey of targetRoomKeys) {
              io.to(roomKey).emit('lock:released', {
                entityType: releasedLock.entityType,
                entityId: releasedLock.entityId,
              });
            }
          }
        }

        for (const roomKey of rooms) {
          const left = await leaveRoom(io, socket, roomKey);
          if (left) {
            socket.to(roomKey).emit('presence:leave', { userId: left.userId });
          }
        }

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
