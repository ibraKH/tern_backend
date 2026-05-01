import type { Server, Socket } from 'socket.io';

import type { RoomState, OnlineUser } from './types';
import type { SocketAuthedUser } from './auth.middleware';
import type { ActivityEntry } from '../services/collab/activity.service';

const rooms = new Map<string, RoomState>();

const COLOR_PALETTE = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899',
] as const;

function getOrCreateRoom(roomKey: string, modelName?: string): RoomState {
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
  return COLOR_PALETTE[room.users.size % COLOR_PALETTE.length];
}

function getAuthedUser(socket: Socket): SocketAuthedUser {
  const user = (socket.data as { user?: SocketAuthedUser } | undefined)?.user;
  if (!user) throw new Error('[collab] Socket missing user — apply socketAuthMiddleware first.');
  return user;
}

/**
 * Add a user to a room, handling reconnections gracefully.
 * Returns the OnlineUser entry (new or existing).
 */
export async function joinRoom(
  io: Server,
  socket: Socket,
  roomKey: string,
  modelName?: string
): Promise<OnlineUser> {
  const user = getAuthedUser(socket);
  const room = getOrCreateRoom(roomKey, modelName);
  const key = userKey(user.uid);
  const previous = room.users.get(key);
  const previousSocketId = room.socketIdByUserId.get(key);

  // Same socket rejoining — no-op.
  if (previous && previousSocketId === socket.id) {
    await Promise.resolve(socket.join(roomKey));
    return previous;
  }

  // Different socket — evict stale one.
  if (previous && previousSocketId && previousSocketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(previousSocketId);
    await Promise.resolve(oldSocket?.leave(roomKey));
  }

  const onlineUser: OnlineUser = previous
    ? { ...previous, email: user.email }
    : { userId: user.uid, email: user.email, role: user.role, color: pickNextColor(room) };

  room.users.set(key, onlineUser);
  room.socketIdByUserId.set(key, socket.id);
  await Promise.resolve(socket.join(roomKey));
  return onlineUser;
}

export async function leaveRoom(_io: Server, socket: Socket, roomKey: string): Promise<OnlineUser | undefined> {
  const room = rooms.get(roomKey);
  if (!room) return undefined;

  let user: SocketAuthedUser;
  try { user = getAuthedUser(socket); } catch { return undefined; }

  const key = userKey(user.uid);
  const existing = room.users.get(key);
  if (!existing) return undefined;

  // Prevent a stale/replaced socket from evicting the active user.
  if (room.socketIdByUserId.get(key) !== socket.id) {
    await Promise.resolve(socket.leave(roomKey));
    return undefined;
  }

  room.users.delete(key);
  room.socketIdByUserId.delete(key);
  await Promise.resolve(socket.leave(roomKey));

  if (room.users.size === 0) rooms.delete(roomKey);
  return existing;
}

export function getRoom(roomKey: string): RoomState | undefined {
  return rooms.get(roomKey);
}

export function getUserColor(userId: number, roomKey: string): string | undefined {
  return rooms.get(roomKey)?.users.get(userKey(userId))?.color;
}

/** Find all socket IDs for a user across all rooms. */
export function getSocketIdsByUserId(userId: number): string[] {
  const ids: string[] = [];
  const key = userKey(userId);
  for (const room of rooms.values()) {
    const sid = room.socketIdByUserId.get(key);
    if (sid) ids.push(sid);
  }
  return [...new Set(ids)];
}

/** Broadcast an activity entry to everyone in a room. */
export function broadcastActivity(io: Server, roomKey: string, entry: ActivityEntry): void {
  io.to(roomKey).emit('activity:new', { entry });
}

/** Count unique users currently connected across all rooms. */
export function getConnectedUserCount(): number {
  const seen = new Set<string>();
  for (const room of rooms.values()) {
    for (const key of room.users.keys()) seen.add(key);
  }
  return seen.size;
}
