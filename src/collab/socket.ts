import type { Server, Socket } from 'socket.io';

import { joinRoom, leaveRoom, getRoom, getUserColor } from './roomManager';
import type { SocketAuthedUser } from './auth.middleware';
import { getRecentActivity } from '../services/collab/activity.service';
import { acquireLock, releaseLock, releaseAllLocksForUser, checkLockOwnership } from '../services/collab/locks.service';
import { cacheLock, evictLock, evictLocksForUser, checkCache } from './lockCache';

export const COLLAB_THROTTLE_MS = 50;
export const PATCH_COALESCE_MS = 20;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function getSocketUser(socket: Socket): SocketAuthedUser | undefined {
  return (socket.data as { user?: SocketAuthedUser } | undefined)?.user;
}

// Room keys are prefixed by type so a modelName and a modelId never collide.
function resolveRoomKey(payload: unknown): { roomKey: string; modelName?: string } | { error: string } {
  const p = payload as { modelId?: number; modelName?: string } | undefined;
  if (isNonEmptyString(p?.modelName)) {
    return { roomKey: `name:${p!.modelName}`, modelName: p!.modelName };
  }
  if (typeof p?.modelId === 'number' && Number.isInteger(p.modelId) && p.modelId > 0) {
    return { roomKey: `model:${p.modelId}`, modelName: isNonEmptyString(p.modelName) ? p.modelName : undefined };
  }
  return { error: 'modelName (non-empty string) or modelId (positive integer) is required' };
}

// ── Throttle bookkeeping ─────────────────────────────────────────────────────

type ThrottleKey = string;
type PendingBroadcast = { timer: NodeJS.Timeout; lastPayload: unknown; socketId: string };

function makeThrottleKey(event: string, roomKey: string, userId: number): ThrottleKey {
  return `${event}::${roomKey}::${userId}`;
}

// ── Handler registration ─────────────────────────────────────────────────────

export function registerCollabHandlers(io: Server): void {
  const pending = new Map<ThrottleKey, PendingBroadcast>();
  // Keyed by `socketId:modelName:entityType:entityId:field` — last write wins per field.
  const patchFlush = new Map<string, { timer: NodeJS.Timeout; value: unknown }>();

  io.on('connection', (socket) => {
    /** Confirm this socket is the active member for the user in the given room. */
    const isCurrentRoomSocket = (roomKey: string, userId: number): { color: string } | undefined => {
      if (!socket.rooms.has(roomKey)) return undefined;
      const room = getRoom(roomKey);
      if (!room) return undefined;
      const entry = room.users.get(String(userId));
      if (!entry) return undefined;
      if (room.socketIdByUserId.get(String(userId)) !== socket.id) return undefined;
      return { color: entry.color };
    };

    /** Debounce cursor/viewport broadcasts to avoid flooding. */
    const scheduleBroadcast = (
      event: 'cursor:move' | 'viewport:update',
      roomKey: string,
      userId: number,
      socketId: string,
      payload: unknown,
      build: (p: unknown) => unknown
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

        // Re-validate that this socket is still the active room member.
        const room = getRoom(roomKey);
        const activeSocketId = room?.socketIdByUserId.get(String(userId));
        if (!activeSocketId || activeSocketId !== entry.socketId) return;

        const sender = io.sockets.sockets.get(entry.socketId);
        if (!sender || !sender.rooms.has(roomKey)) return;

        sender.to(roomKey).emit(event, build(entry.lastPayload));
      }, COLLAB_THROTTLE_MS);

      pending.set(key, { timer, lastPayload: payload, socketId });
    };

    // ── room:join ──────────────────────────────────────────────────────────

    socket.on('room:join', (payload: unknown) => {
      const resolved = resolveRoomKey(payload);
      if ('error' in resolved) {
        socket.emit('error:validation', { message: resolved.error });
        return;
      }

      const { roomKey, modelName } = resolved;

      void (async () => {
        const user = await joinRoom(io, socket, roomKey, modelName);
        const room = getRoom(roomKey);
        const users = room ? Array.from(room.users.values()) : [];

        socket.emit('presence:sync', { users });
        socket.to(roomKey).emit('presence:join', { user });

        // Send recent activity (best-effort, never blocks join).
        try {
          if (modelName) {
            const activity = await getRecentActivity(modelName);
            socket.emit('activity:recent', { activity });
          } else {
            socket.emit('activity:recent', { activity: [] });
          }
        } catch {
          socket.emit('activity:recent', { activity: [] });
        }
      })().catch(() => {
        socket.emit('error:validation', { message: 'Failed to join room' });
      });
    });

    // ── cursor:move ────────────────────────────────────────────────────────

    socket.on('cursor:move', (payload: unknown) => {
      const p = payload as { x?: number; y?: number } | undefined;
      const resolved = resolveRoomKey(payload);
      if ('error' in resolved || !isFiniteNumber(p?.x) || !isFiniteNumber(p?.y)) {
        socket.emit('error:validation', { message: 'cursor:move requires { modelName, x, y }' });
        return;
      }

      const user = getSocketUser(socket);
      if (!user) return;
      const membership = isCurrentRoomSocket(resolved.roomKey, user.uid);
      if (!membership) return;

      scheduleBroadcast('cursor:move', resolved.roomKey, user.uid, socket.id, { x: p!.x, y: p!.y }, (last) => {
        const { x, y } = last as { x: number; y: number };
        return { userId: user.uid, color: membership.color, x, y };
      });
    });

    // ── viewport:update ────────────────────────────────────────────────────

    socket.on('viewport:update', (payload: unknown) => {
      const p = payload as { x?: number; y?: number; zoom?: number } | undefined;
      const resolved = resolveRoomKey(payload);
      if ('error' in resolved || !isFiniteNumber(p?.x) || !isFiniteNumber(p?.y) || !isFiniteNumber(p?.zoom)) {
        socket.emit('error:validation', { message: 'viewport:update requires { modelName, x, y, zoom }' });
        return;
      }

      const user = getSocketUser(socket);
      if (!user) return;
      const membership = isCurrentRoomSocket(resolved.roomKey, user.uid);
      if (!membership) return;

      scheduleBroadcast('viewport:update', resolved.roomKey, user.uid, socket.id, { x: p!.x, y: p!.y, zoom: p!.zoom }, (last) => {
        const { x, y, zoom } = last as { x: number; y: number; zoom: number };
        return { userId: user.uid, x, y, zoom };
      });
    });

    // ── lock:acquire ───────────────────────────────────────────────────────

    socket.on('lock:acquire', (payload: unknown) => {
      const p = payload as { entityType?: string; entityId?: number; modelName?: string } | undefined;
      if (!isNonEmptyString(p?.entityType) || !isFiniteNumber(p?.entityId) || !isNonEmptyString(p?.modelName)) {
        socket.emit('error:validation', { message: 'lock:acquire requires { entityType, entityId, modelName }' });
        return;
      }

      const user = getSocketUser(socket);
      if (!user) return;

      const roomKey = `name:${p!.modelName}`;
      if (!socket.rooms.has(roomKey)) {
        socket.emit('error:validation', { message: 'You must join the room before acquiring locks' });
        return;
      }

      void (async () => {
        const result = await acquireLock({
          entityType: p!.entityType!,
          entityId: p!.entityId!,
          modelName: p!.modelName!,
          userId: user.uid,
        });

        if (result.success) {
          cacheLock(p!.modelName!, p!.entityType!, p!.entityId!, user.uid);
          const color = getUserColor(user.uid, roomKey) ?? '#999';
          io.to(roomKey).emit('lock:acquired', {
            entityType: p!.entityType,
            entityId: p!.entityId,
            modelName: p!.modelName,
            userId: user.uid,
            lockedBy: user.email,
            color,
          });
        } else {
          socket.emit('lock:denied', {
            entityType: p!.entityType,
            entityId: p!.entityId,
            modelName: p!.modelName,
            lockedBy: result.heldBy,
          });
        }
      })().catch((err) => {
        console.error('[collab] lock:acquire error:', err);
        socket.emit('error:validation', { message: 'Failed to acquire lock' });
      });
    });

    // ── lock:release ───────────────────────────────────────────────────────

    socket.on('lock:release', (payload: unknown) => {
      const p = payload as { entityType?: string; entityId?: number; modelName?: string } | undefined;
      if (!isNonEmptyString(p?.entityType) || !isFiniteNumber(p?.entityId) || !isNonEmptyString(p?.modelName)) {
        socket.emit('error:validation', { message: 'lock:release requires { entityType, entityId, modelName }' });
        return;
      }

      const user = getSocketUser(socket);
      if (!user) return;

      void (async () => {
        const deleted = await releaseLock({
          entityType: p!.entityType!,
          entityId: p!.entityId!,
          modelName: p!.modelName!,
          userId: user.uid,
        });

        if (deleted > 0) {
          evictLock(p!.modelName!, p!.entityType!, p!.entityId!);
          const roomKey = `name:${p!.modelName}`;
          io.to(roomKey).emit('lock:released', {
            entityType: p!.entityType,
            entityId: p!.entityId,
            modelName: p!.modelName,
          });
        }
      })().catch((err) => {
        console.error('[collab] lock:release error:', err);
      });
    });

    // ── entity:patch ───────────────────────────────────────────────────────

    socket.on('entity:patch', (payload: unknown) => {
      const p = payload as {
        entityType?: string; entityId?: number; modelName?: string;
        field?: string; value?: unknown;
      } | undefined;

      if (
        !isNonEmptyString(p?.entityType) ||
        !isFiniteNumber(p?.entityId) ||
        !isNonEmptyString(p?.modelName) ||
        !isNonEmptyString(p?.field) ||
        p?.value === undefined
      ) {
        socket.emit('error:validation', { message: 'entity:patch requires { entityType, entityId, modelName, field, value }' });
        return;
      }

      const user = getSocketUser(socket);
      if (!user) return;

      const roomKey = `name:${p!.modelName}`;
      if (!socket.rooms.has(roomKey)) {
        socket.emit('error:validation', { message: 'You must join the room first' });
        return;
      }

      void (async () => {

        // Cache-first lock check — skips DB round-trip on warm path.
        const hit = checkCache(p!.modelName!, p!.entityType!, p!.entityId!, user.uid);
        let owned: boolean;
        let reason: string | undefined;

        if (hit !== null) {
          owned = hit === 'owned';
          reason = hit === 'not_owner' ? 'not_owner' : undefined;
        } else {
          const ownership = await checkLockOwnership({
            entityType: p!.entityType!,
            entityId: p!.entityId!,
            modelName: p!.modelName!,
            userId: user.uid,
          });
          owned = ownership.owned;
          reason = ownership.reason;
          if (owned) cacheLock(p!.modelName!, p!.entityType!, p!.entityId!, user.uid);
        }

        if (!owned) {
          socket.emit('error:patch', { reason });
          return;
        }

        // Coalesce rapid patches for the same field — last write wins within the window.
        const flushKey = `${socket.id}:${p!.modelName}:${p!.entityType}:${p!.entityId}:${p!.field}`;
        const existing = patchFlush.get(flushKey);
        if (existing) {
          existing.value = p!.value;
          return;
        }

        const timer = setTimeout(() => {
          const entry = patchFlush.get(flushKey);
          if (!entry) return;
          patchFlush.delete(flushKey);
          if (!socket.rooms.has(roomKey)) return;

          socket.to(roomKey).emit('entity:patch', {
            entityType: p!.entityType,
            entityId: p!.entityId,
            field: p!.field,
            value: entry.value,
            userId: user.uid,
          });
        }, PATCH_COALESCE_MS);

        patchFlush.set(flushKey, { timer, value: p!.value });
      })().catch((err) => {
        console.error('[collab] entity:patch error:', err);
      });
    });

    // ── disconnecting ──────────────────────────────────────────────────────

    socket.on('disconnecting', () => {
      void (async () => {
        const currentUser = getSocketUser(socket);
        const socketRooms = Array.from(socket.rooms).filter((r) => r !== socket.id);

        // Release all editing locks held by this user.
        if (currentUser) {
          try {
            const released = await releaseAllLocksForUser(currentUser.uid);
            evictLocksForUser(currentUser.uid);
            for (const lock of released) {
              const lockRoomKey = `name:${lock.modelName}`;
              io.to(lockRoomKey).emit('lock:released', {
                entityType: lock.entityType,
                entityId: lock.entityId,
                modelName: lock.modelName,
              });
            }
          } catch (err) {
            console.error('[collab] disconnect lock cleanup failed:', err);
          }
        }

        // Leave all rooms and broadcast presence:leave.
        for (const roomKey of socketRooms) {
          const left = await leaveRoom(io, socket, roomKey);
          if (left) {
            socket.to(roomKey).emit('presence:leave', { userId: left.userId });
          }
        }

        // Cancel pending throttled broadcasts.
        if (currentUser) {
          for (const roomKey of socketRooms) {
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

        // Cancel pending patch coalescing timers for this socket.
        for (const [k, entry] of patchFlush) {
          if (k.startsWith(`${socket.id}:`)) {
            clearTimeout(entry.timer);
            patchFlush.delete(k);
          }
        }
      })().catch(() => { /* best-effort cleanup */ });
    });
  });
}
