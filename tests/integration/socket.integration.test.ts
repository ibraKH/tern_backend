jest.mock('../../src/services/collab/locks.service', () => ({
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
  releaseAllLocksForSocket: jest.fn(),
}));

import http from 'http';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';

import { initIo } from '../../src/socket';
import { socketAuthMiddleware } from '../../src/collab/auth.middleware';
import { registerCollabHandlers } from '../../src/collab/socket';
import { signToken } from '../../src/utils/jwt';
import {
  acquireLock,
  releaseAllLocksForSocket,
  releaseLock,
} from '../../src/services/collab/locks.service';

type PresenceSync = { users: Array<{ userId: number; email: string; color: string }> };

describe('socket integration - lock handlers', () => {
  let server: http.Server;
  let port: number;
  let frontendUrl: string;
  let closeIo: (() => Promise<void>) | undefined;

  beforeAll((done) => {
    frontendUrl = 'http://localhost:5173';
    process.env.FRONTEND_URL = frontendUrl;

    server = http.createServer((_req, res) => res.end('ok'));
    const io = initIo(server, frontendUrl);
    io.use(socketAuthMiddleware);
    registerCollabHandlers(io);

    closeIo = () => new Promise<void>((resolve) => io.close(() => resolve()));

    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        done(new Error('Failed to bind test server'));
        return;
      }
      port = address.port;
      done();
    });
  });

  afterAll(async () => {
    if (closeIo) await closeIo();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function once<T>(socket: ClientSocket, event: string): Promise<T> {
    return new Promise((resolve) => socket.once(event, (data: T) => resolve(data)));
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function connectClient(uid: number, email: string): Promise<ClientSocket> {
    const url = `http://localhost:${port}`;
    const token = signToken({ uid, email, role: 'Editor' });

    return new Promise((resolve, reject) => {
      const socket = Client(url, {
        transports: ['websocket'],
        timeout: 2500,
        auth: { token },
        extraHeaders: { Origin: frontendUrl },
      });

      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => {
        socket.close();
        reject(err);
      });
    });
  }

  it('lock:acquire acknowledges the sender and broadcasts to room members', async () => {
    (acquireLock as jest.Mock).mockResolvedValue({ success: true });

    const modelId = Date.now();
    const modelName = `model-${Date.now()}-lock-acquire`;
    const s1 = await connectClient(2001, 'u2001@test.com');
    const s2 = await connectClient(2002, 'u2002@test.com');

    const s1SyncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelId, modelName });
    await s1SyncP;

    const s2SyncP = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelId, modelName });
    await s2SyncP;

    const ackP = once<{
      entityType: 'node' | 'edge';
      entityId: number;
      userId: number;
      color: string;
    }>(s1, 'lock:ack');

    const broadcastP = once<{
      entityType: 'node' | 'edge';
      entityId: number;
      userId: number;
      color: string;
    }>(s2, 'lock:acquired');

    s1.emit('lock:acquire', {
      entityType: 'node',
      entityId: '501',
      modelId,
    });

    const [ack, received] = await Promise.all([ackP, broadcastP]);

    expect(ack.entityType).toBe('node');
    expect(ack.entityId).toBe(501);
    expect(ack.userId).toBe(2001);
    expect(received.entityType).toBe('node');
    expect(received.entityId).toBe(501);
    expect(received.userId).toBe(2001);
    expect(typeof received.color).toBe('string');

    expect(acquireLock).toHaveBeenCalledWith({
      entityType: 'node',
      entityId: 501,
      modelId,
      modelName: undefined,
      userId: 2001,
    });

    s1.close();
    s2.close();
  });

  it('lock:acquire emits lock:denied only to requester when service rejects', async () => {
    (acquireLock as jest.Mock).mockResolvedValue({
      success: false,
      heldBy: 'owner@example.com',
    });

    const modelName = `model-${Date.now()}-lock-denied`;
    const s1 = await connectClient(2101, 'u2101@test.com');
    const s2 = await connectClient(2102, 'u2102@test.com');

    const s1SyncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelName });
    await s1SyncP;

    const s2SyncP = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelName });
    await s2SyncP;

    let roomBroadcastCount = 0;
    s2.on('lock:denied', () => {
      roomBroadcastCount++;
    });
    s2.on('lock:acquired', () => {
      roomBroadcastCount++;
    });

    const deniedP = once<{
      entityType: 'node' | 'edge';
      entityId: string | number;
      heldBy: string | null;
    }>(s1, 'lock:denied');

    s1.emit('lock:acquire', {
      entityType: 'edge',
      entityId: 700,
      modelName,
    });

    const denied = await deniedP;

    expect(denied).toEqual({
      entityType: 'edge',
      entityId: 700,
      heldBy: 'owner@example.com',
    });

    await delay(50);
    expect(roomBroadcastCount).toBe(0);

    s1.close();
    s2.close();
  });

  it('lock:release broadcasts lock:released when release succeeds', async () => {
    (releaseLock as jest.Mock).mockResolvedValue(1);

    const modelName = `model-${Date.now()}-lock-release`;
    const s1 = await connectClient(2201, 'u2201@test.com');
    const s2 = await connectClient(2202, 'u2202@test.com');

    const s1SyncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelName });
    await s1SyncP;

    const s2SyncP = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelName });
    await s2SyncP;

    const releasedP = once<{ entityType: 'node' | 'edge'; entityId: string | number }>(
      s2,
      'lock:released'
    );

    s1.emit('lock:release', {
      entityType: 'node',
      entityId: '808',
      modelName,
    });

    const released = await releasedP;

    expect(released).toEqual({
      entityType: 'node',
      entityId: 808,
    });

    expect(releaseLock).toHaveBeenCalledWith({
      entityType: 'node',
      entityId: 808,
      modelName,
      userId: 2201,
    });

    s1.close();
    s2.close();
  });

  it('lock:refresh renews the sender lock without broadcasting to other clients', async () => {
    (acquireLock as jest.Mock).mockResolvedValue({ success: true });

    const modelName = `model-${Date.now()}-lock-refresh`;
    const s1 = await connectClient(2251, 'u2251@test.com');
    const s2 = await connectClient(2252, 'u2252@test.com');

    const s1SyncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelName });
    await s1SyncP;

    const s2SyncP = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelName });
    await s2SyncP;

    const ackP = once<{ entityType: 'node' | 'edge'; entityId: number; userId: number }>(s1, 'lock:ack');
    let watcherBroadcasts = 0;
    s2.on('lock:acquired', () => {
      watcherBroadcasts++;
    });

    s1.emit('lock:refresh', {
      entityType: 'edge',
      entityId: '901',
      modelName,
    });

    const ack = await ackP;

    expect(ack).toEqual({
      entityType: 'edge',
      entityId: 901,
      userId: 2251,
      color: expect.any(String),
    });

    await delay(50);
    expect(watcherBroadcasts).toBe(0);

    s1.close();
    s2.close();
  });

  it('disconnecting releases all locks and broadcasts each lock:released', async () => {
    (releaseAllLocksForSocket as jest.Mock).mockResolvedValue([
      { modelId: 1, entityType: 'node', entityId: 1, modelName: 'Model-A' },
    ]);

    const sOwner = await connectClient(2301, 'u2301@test.com');
    const sWatcherA = await connectClient(2302, 'u2302@test.com');
    const sWatcherB = await connectClient(2303, 'u2303@test.com');

    const ownerSyncA = once<PresenceSync>(sOwner, 'presence:sync');
    sOwner.emit('room:join', { modelId: 1, modelName: 'Model-A' });
    await ownerSyncA;

    const ownerSyncB = once<PresenceSync>(sOwner, 'presence:sync');
    sOwner.emit('room:join', { modelId: 2, modelName: 'Model-B' });
    await ownerSyncB;

    const watcherASync = once<PresenceSync>(sWatcherA, 'presence:sync');
    sWatcherA.emit('room:join', { modelId: 1, modelName: 'Model-A' });
    await watcherASync;

    const watcherBSync = once<PresenceSync>(sWatcherB, 'presence:sync');
    sWatcherB.emit('room:join', { modelId: 2, modelName: 'Model-B' });
    await watcherBSync;

    const releaseAP = once<{ entityType: 'node' | 'edge'; entityId: number }>(sWatcherA, 'lock:released');
    let releaseBCount = 0;
    sWatcherB.on('lock:released', () => {
      releaseBCount++;
    });

    sOwner.close();

    const releaseA = await releaseAP;

    expect(releaseA).toEqual({ entityType: 'node', entityId: 1 });

    await delay(50);
    expect(releaseBCount).toBe(0);
    expect(releaseAllLocksForSocket).toHaveBeenCalledWith(2301, {
      modelIds: [1, 2],
      modelNames: ['Model-A', 'Model-B'],
    });

    sWatcherA.close();
    sWatcherB.close();
  });
});
