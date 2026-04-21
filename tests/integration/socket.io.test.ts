// Mock locks.service so socket handlers never touch the real DB.
// Safe defaults prevent existing tests from breaking on disconnect cleanup.
jest.mock('../../src/services/collab/locks.service', () => ({
  acquireLock: jest.fn().mockResolvedValue({ success: true }),
  releaseLock: jest.fn().mockResolvedValue(1),
  releaseAllLocksForUser: jest.fn().mockResolvedValue([]),
  checkLockOwnership: jest.fn().mockResolvedValue({ owned: false, reason: 'lock_required' }),
  cleanupExpiredLocks: jest.fn().mockResolvedValue([]),
}));

import { createServer, type Server as HttpServer } from 'http';
import { type AddressInfo } from 'net';
import type { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import app from '../../src/app';
import { initIo } from '../../src/socket';
import { socketAuthMiddleware } from '../../src/collab/auth.middleware';
import { registerCollabHandlers } from '../../src/collab/socket';
import { signToken } from '../../src/utils/jwt';
import * as locksService from '../../src/services/collab/locks.service';

let httpServer: HttpServer;
let ioServer: SocketIOServer;
let port: number;

function connectClient(token: string): ClientSocket {
  return ioClient(`http://localhost:${port}`, {
    autoConnect: true,
    transports: ['websocket'],
    auth: { token },
  });
}

function once<T>(socket: ClientSocket, event: string, timeout = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeout);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

beforeAll((done) => {
  httpServer = createServer(app);
  ioServer = initIo(httpServer, 'http://localhost:5173');
  ioServer.use(socketAuthMiddleware);
  registerCollabHandlers(ioServer);
  httpServer.listen(0, () => {
    port = (httpServer.address() as AddressInfo).port;
    done();
  });
});

afterAll((done) => {
  ioServer.close();
  httpServer.close(done);
});

describe('Socket.IO basic connectivity', () => {
  it('rejects connection without token', (done) => {
    const client = ioClient(`http://localhost:${port}`, {
      autoConnect: true,
      transports: ['websocket'],
    });
    client.on('connect_error', (err) => {
      expect(err.message).toContain('Unauthorized');
      client.disconnect();
      done();
    });
  });

  it('accepts connection with valid token', (done) => {
    const token = signToken({ uid: 1, email: 'test@x.com', role: 'Editor' });
    const client = connectClient(token);
    client.on('connect', () => {
      expect(client.connected).toBe(true);
      client.disconnect();
      done();
    });
  });
});

describe('Room lifecycle and presence', () => {
  let clientA: ClientSocket;
  let clientB: ClientSocket;

  afterEach(async () => {
    clientA?.disconnect();
    clientB?.disconnect();
    await delay(100);
  });

  it('first user gets presence:sync with themselves', async () => {
    const token = signToken({ uid: 10, email: 'a@x.com', role: 'Editor' });
    clientA = connectClient(token);
    await once(clientA, 'connect');

    clientA.emit('room:join', { modelName: 'TestModel' });
    const sync = await once<{ users: unknown[] }>(clientA, 'presence:sync');

    expect(sync.users).toHaveLength(1);
    expect(sync.users[0]).toMatchObject({ userId: 10, email: 'a@x.com' });
  });

  it('second user triggers presence:join on first user', async () => {
    const tokenA = signToken({ uid: 20, email: 'a@x.com', role: 'Editor' });
    const tokenB = signToken({ uid: 21, email: 'b@x.com', role: 'Editor' });

    clientA = connectClient(tokenA);
    await once(clientA, 'connect');
    clientA.emit('room:join', { modelName: 'PresenceTest' });
    await once(clientA, 'presence:sync');

    clientB = connectClient(tokenB);
    await once(clientB, 'connect');
    const joinPromise = once<{ user: { userId: number } }>(clientA, 'presence:join');
    clientB.emit('room:join', { modelName: 'PresenceTest' });

    const join = await joinPromise;
    expect(join.user.userId).toBe(21);
  });

  it('disconnecting user triggers presence:leave', async () => {
    const tokenA = signToken({ uid: 30, email: 'a@x.com', role: 'Editor' });
    const tokenB = signToken({ uid: 31, email: 'b@x.com', role: 'Editor' });

    clientA = connectClient(tokenA);
    await once(clientA, 'connect');
    clientA.emit('room:join', { modelName: 'LeaveTest' });
    await once(clientA, 'presence:sync');

    clientB = connectClient(tokenB);
    await once(clientB, 'connect');
    clientB.emit('room:join', { modelName: 'LeaveTest' });
    await once(clientB, 'presence:sync');

    const leavePromise = once<{ userId: number }>(clientA, 'presence:leave');
    clientB.disconnect();

    const leave = await leavePromise;
    expect(leave.userId).toBe(31);
  });
});

describe('Cursor and viewport sync', () => {
  let sender: ClientSocket;
  let receiver: ClientSocket;

  afterEach(async () => {
    sender?.disconnect();
    receiver?.disconnect();
    await delay(100);
  });

  it('broadcasts cursor:move to other users (excluding sender)', async () => {
    const tokenS = signToken({ uid: 40, email: 's@x.com', role: 'Editor' });
    const tokenR = signToken({ uid: 41, email: 'r@x.com', role: 'Editor' });

    sender = connectClient(tokenS);
    await once(sender, 'connect');
    sender.emit('room:join', { modelName: 'CursorTest' });
    await once(sender, 'presence:sync');

    receiver = connectClient(tokenR);
    await once(receiver, 'connect');
    receiver.emit('room:join', { modelName: 'CursorTest' });
    await once(receiver, 'presence:sync');

    const cursorPromise = once<{ userId: number; x: number; y: number }>(receiver, 'cursor:move');
    sender.emit('cursor:move', { modelName: 'CursorTest', x: 100, y: 200 });

    const cursor = await cursorPromise;
    expect(cursor).toMatchObject({ userId: 40, x: 100, y: 200 });
  });

  it('rejects cursor:move with invalid payload', async () => {
    const token = signToken({ uid: 42, email: 'x@x.com', role: 'Editor' });
    sender = connectClient(token);
    await once(sender, 'connect');

    sender.emit('room:join', { modelName: 'CursorInvalid' });
    await once(sender, 'presence:sync');

    const errPromise = once<{ message: string }>(sender, 'error:validation');
    sender.emit('cursor:move', { modelName: 'CursorInvalid', x: NaN, y: 100 });

    const err = await errPromise;
    expect(err.message).toBeDefined();
  });

  it('broadcasts viewport:update to other users', async () => {
    const tokenS = signToken({ uid: 50, email: 's@x.com', role: 'Editor' });
    const tokenR = signToken({ uid: 51, email: 'r@x.com', role: 'Editor' });

    sender = connectClient(tokenS);
    await once(sender, 'connect');
    sender.emit('room:join', { modelName: 'ViewportTest' });
    await once(sender, 'presence:sync');

    receiver = connectClient(tokenR);
    await once(receiver, 'connect');
    receiver.emit('room:join', { modelName: 'ViewportTest' });
    await once(receiver, 'presence:sync');

    const vpPromise = once<{ userId: number; zoom: number }>(receiver, 'viewport:update');
    sender.emit('viewport:update', { modelName: 'ViewportTest', x: 10, y: 20, zoom: 1.5 });

    const vp = await vpPromise;
    expect(vp).toMatchObject({ userId: 50, zoom: 1.5 });
  });
});

describe('Validation errors', () => {
  let client: ClientSocket;

  afterEach(() => {
    client?.disconnect();
  });

  it('emits error:validation for room:join with missing modelName', async () => {
    const token = signToken({ uid: 60, email: 'x@x.com', role: 'Editor' });
    client = connectClient(token);
    await once(client, 'connect');

    const errPromise = once<{ message: string }>(client, 'error:validation');
    client.emit('room:join', {});

    const err = await errPromise;
    expect(err.message).toBeDefined();
  });
});

describe('entity:patch — real-time field broadcast with lock validation (#42)', () => {
  const mockCheckLockOwnership = locksService.checkLockOwnership as jest.Mock;

  let owner: ClientSocket;
  let observer: ClientSocket;

  afterEach(async () => {
    owner?.disconnect();
    observer?.disconnect();
    await delay(100);
    mockCheckLockOwnership.mockResolvedValue({ owned: false, reason: 'lock_required' });
  });

  it('emits error:validation for an incomplete payload', async () => {
    const token = signToken({ uid: 70, email: 'o@x.com', role: 'Editor' });
    owner = connectClient(token);
    await once(owner, 'connect');
    owner.emit('room:join', { modelName: 'PatchValidation' });
    await once(owner, 'presence:sync');

    const errPromise = once<{ message: string }>(owner, 'error:validation');
    owner.emit('entity:patch', { modelName: 'PatchValidation' }); // missing entityType, field, value

    const err = await errPromise;
    expect(err.message).toBeDefined();
  });

  it('emits error:validation when sender has not joined the room', async () => {
    const token = signToken({ uid: 71, email: 'o@x.com', role: 'Editor' });
    owner = connectClient(token);
    await once(owner, 'connect');
    // deliberately skip room:join

    const errPromise = once<{ message: string }>(owner, 'error:validation');
    owner.emit('entity:patch', {
      modelName: 'NotJoined', entityType: 'node', entityId: 1, field: 'name', value: 'X',
    });

    const err = await errPromise;
    expect(err.message).toContain('join');
  });

  it('emits error:patch to sender when lock is not held', async () => {
    mockCheckLockOwnership.mockResolvedValue({ owned: false, reason: 'lock_required' });

    const token = signToken({ uid: 72, email: 'nolock@x.com', role: 'Editor' });
    owner = connectClient(token);
    await once(owner, 'connect');
    owner.emit('room:join', { modelName: 'PatchNoLock' });
    await once(owner, 'presence:sync');

    const errPromise = once<{ reason: string }>(owner, 'error:patch');
    owner.emit('entity:patch', {
      modelName: 'PatchNoLock', entityType: 'node', entityId: 1, field: 'name', value: 'X',
    });

    const err = await errPromise;
    expect(err.reason).toBe('lock_required');
  });

  it('emits error:patch to sender when lock belongs to another user', async () => {
    mockCheckLockOwnership.mockResolvedValue({ owned: false, reason: 'not_owner' });

    const token = signToken({ uid: 73, email: 'wrong@x.com', role: 'Editor' });
    owner = connectClient(token);
    await once(owner, 'connect');
    owner.emit('room:join', { modelName: 'PatchWrongUser' });
    await once(owner, 'presence:sync');

    const errPromise = once<{ reason: string }>(owner, 'error:patch');
    owner.emit('entity:patch', {
      modelName: 'PatchWrongUser', entityType: 'node', entityId: 1, field: 'label', value: 'X',
    });

    const err = await errPromise;
    expect(err.reason).toBe('not_owner');
  });

  it('emits error:patch to sender when lock has expired', async () => {
    mockCheckLockOwnership.mockResolvedValue({ owned: false, reason: 'lock_expired' });

    const token = signToken({ uid: 74, email: 'expired@x.com', role: 'Editor' });
    owner = connectClient(token);
    await once(owner, 'connect');
    owner.emit('room:join', { modelName: 'PatchExpired' });
    await once(owner, 'presence:sync');

    const errPromise = once<{ reason: string }>(owner, 'error:patch');
    owner.emit('entity:patch', {
      modelName: 'PatchExpired', entityType: 'node', entityId: 1, field: 'name', value: 'X',
    });

    const err = await errPromise;
    expect(err.reason).toBe('lock_expired');
  });

  it('broadcasts entity:patch to all other room members when lock is valid', async () => {
    mockCheckLockOwnership.mockResolvedValue({ owned: true });

    const tokenOwner = signToken({ uid: 75, email: 'owner@x.com', role: 'Editor' });
    const tokenObs = signToken({ uid: 76, email: 'obs@x.com', role: 'Editor' });

    owner = connectClient(tokenOwner);
    await once(owner, 'connect');
    owner.emit('room:join', { modelName: 'PatchBroadcast' });
    await once(owner, 'presence:sync');

    observer = connectClient(tokenObs);
    await once(observer, 'connect');
    observer.emit('room:join', { modelName: 'PatchBroadcast' });
    await once(observer, 'presence:sync');

    const patchPromise = once<{ entityType: string; entityId: number; field: string; value: string; userId: number }>(
      observer, 'entity:patch',
    );
    owner.emit('entity:patch', {
      modelName: 'PatchBroadcast', entityType: 'node', entityId: 1, field: 'name', value: 'NewName',
    });

    const patch = await patchPromise;
    expect(patch).toMatchObject({ entityType: 'node', entityId: 1, field: 'name', value: 'NewName', userId: 75 });
  });

  it('does not echo entity:patch back to the sender', async () => {
    mockCheckLockOwnership.mockResolvedValue({ owned: true });

    const tokenOwner = signToken({ uid: 77, email: 'solo@x.com', role: 'Editor' });
    const tokenObs = signToken({ uid: 78, email: 'obs2@x.com', role: 'Editor' });

    owner = connectClient(tokenOwner);
    await once(owner, 'connect');
    owner.emit('room:join', { modelName: 'PatchNoEcho' });
    await once(owner, 'presence:sync');

    // A second client must be in the room so the broadcast has somewhere to go.
    observer = connectClient(tokenObs);
    await once(observer, 'connect');
    observer.emit('room:join', { modelName: 'PatchNoEcho' });
    await once(observer, 'presence:sync');

    let senderReceivedPatch = false;
    owner.on('entity:patch', () => { senderReceivedPatch = true; });

    owner.emit('entity:patch', {
      modelName: 'PatchNoEcho', entityType: 'node', entityId: 1, field: 'name', value: 'X',
    });

    await delay(300);
    expect(senderReceivedPatch).toBe(false);
  });
});
