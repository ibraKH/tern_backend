import type { Server, Socket } from 'socket.io';

import type { RoomState, OnlineUser } from './types';
import type { SocketAuthedUser } from './auth.middleware';

const rooms = new Map<string, RoomState>();

const COLOR_PALETTE = [
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#06B6D4',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
] as const;

function getOrCreateRoom(modelName: string): RoomState {
  const existing = rooms.get(modelName);
  if (existing) return existing;

  const room: RoomState = { modelName, users: new Map() };
  rooms.set(modelName, room);
  return room;
}

function userKey(userId: number): string {
  return String(userId);
}

function pickNextColor(room: RoomState): string {
  const used = new Set(Array.from(room.users.values()).map((u) => u.color));
  for (const color of COLOR_PALETTE) {
    if (!used.has(color)) return color;
  }

  // Palette exhausted: wrap around gracefully.
  return COLOR_PALETTE[room.users.size % COLOR_PALETTE.length];
}

function getAuthedUser(socket: Socket): SocketAuthedUser {
  const anySocket = socket as Socket & { data?: { user?: SocketAuthedUser } };
  const user = anySocket.data?.user;
  if (!user) {
    throw new Error('[collab] Socket user missing; ensure socketAuthMiddleware is applied before room operations.');
  }
  return user;
}

export async function joinRoom(io: Server, socket: Socket, modelName: string): Promise<OnlineUser> {
  const user = getAuthedUser(socket);
  const room = getOrCreateRoom(modelName);

  const key = userKey(user.uid);
  const previous = room.users.get(key);

  if (previous && previous.socketId === socket.id) {
    await Promise.resolve(socket.join(modelName));
    return previous;
  }

  if (previous && previous.socketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(previous.socketId);
    await Promise.resolve(oldSocket?.leave(modelName));
  }

  const onlineUser: OnlineUser = previous
    ? { ...previous, email: user.email, socketId: socket.id }
    : {
        userId: user.uid,
        email: user.email,
        color: pickNextColor(room),
        socketId: socket.id,
      };

  room.users.set(key, onlineUser);
  await Promise.resolve(socket.join(modelName));

  return onlineUser;
}

export async function leaveRoom(_io: Server, socket: Socket, modelName: string): Promise<OnlineUser | undefined> {
  const room = rooms.get(modelName);
  if (!room) return undefined;

  let user: SocketAuthedUser | undefined;
  try {
    user = getAuthedUser(socket);
  } catch {
    return undefined;
  }

  const key = userKey(user.uid);
  const existing = room.users.get(key);
  if (!existing) return undefined;

  // Prevent stale/replaced sockets from evicting the active presence entry.
  if (existing.socketId !== socket.id) {
    await Promise.resolve(socket.leave(modelName));
    return undefined;
  }

  room.users.delete(key);
  await Promise.resolve(socket.leave(modelName));

  if (room.users.size === 0) {
    rooms.delete(modelName);
  }

  return existing;
}

export function getRoom(modelName: string): RoomState | undefined {
  return rooms.get(modelName);
}

export function getUserColor(userId: number, modelName: string): string | undefined {
  const room = rooms.get(modelName);
  if (!room) return undefined;
  return room.users.get(userKey(userId))?.color;
}
