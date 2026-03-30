import type { Server, Socket } from 'socket.io';

import type { RoomState, OnlineUser } from './types';
import type { SocketAuthedUser } from './auth.middleware';
import type { ActivityEntry } from '../services/collab/activity.service';

const rooms = new Map<string, RoomState>(); // key = roomKey

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

function getOrCreateRoomByKey(roomKey: string, modelName?: string): RoomState {
  const existing = rooms.get(roomKey);
  if (existing) {
    if (modelName && !existing.modelName) existing.modelName = modelName;
    return existing;
  }

  const room: RoomState = { roomKey, modelName, users: new Map(), socketIdByUserId: new Map() };
  rooms.set(roomKey, room);
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

export async function joinRoom(
  io: Server,
  socket: Socket,
  roomKey: string,
  modelName?: string
): Promise<OnlineUser> {
  const user = getAuthedUser(socket);
  const room = getOrCreateRoomByKey(roomKey, modelName);

  const key = userKey(user.uid);
  const previous = room.users.get(key);
  const previousSocketId = room.socketIdByUserId.get(key);

  if (previous && previousSocketId === socket.id) {
    await Promise.resolve(socket.join(roomKey));
    return previous;
  }

  if (previous && previousSocketId && previousSocketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(previousSocketId);
    await Promise.resolve(oldSocket?.leave(roomKey));
  }

  const onlineUser: OnlineUser = previous
    ? { ...previous, email: user.email }
    : {
        userId: user.uid,
        email: user.email,
        color: pickNextColor(room),
      };

  room.users.set(key, onlineUser);
  room.socketIdByUserId.set(key, socket.id);
  await Promise.resolve(socket.join(roomKey));

  return onlineUser;
}

export async function leaveRoom(_io: Server, socket: Socket, roomKey: string): Promise<OnlineUser | undefined> {
  const room = rooms.get(roomKey);
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

  const activeSocketId = room.socketIdByUserId.get(key);

  // Prevent stale/replaced sockets from evicting the active presence entry.
  if (activeSocketId !== socket.id) {
    await Promise.resolve(socket.leave(roomKey));
    return undefined;
  }

  room.users.delete(key);
  room.socketIdByUserId.delete(key);
  await Promise.resolve(socket.leave(roomKey));

  if (room.users.size === 0) {
    rooms.delete(roomKey);
  }

  return existing;
}

export function getRoom(roomKey: string): RoomState | undefined {
  return rooms.get(roomKey);
}

export function getUserColor(userId: number, roomKey: string): string | undefined {
  const room = rooms.get(roomKey);
  if (!room) return undefined;
  return room.users.get(userKey(userId))?.color;
}

// Broadcast a new activity entry to all sockets in a collab room.
// Called by features like comments, milestones, and model saves to push live updates.
// The caller must pass the already-resolved room key (e.g. "name:foo" or "model:5").
export function broadcastActivity(io: Server, roomKey: string, entry: ActivityEntry): void {
  io.to(roomKey).emit('activity:new', { entry });
}

export function getSocketIdsByUserId(io: Server, userId: number): string[] {
  const socketIds: string[] = [];
  const userKeyStr = userKey(userId);

  for (const room of rooms.values()) {
    const socketId = room.socketIdByUserId.get(userKeyStr);
    if (socketId && io.sockets.sockets.get(socketId)) {
      socketIds.push(socketId);
    }
  }

  return socketIds;
}
