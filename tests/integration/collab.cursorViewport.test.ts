import http from 'http';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';

import { initIo } from '../../src/socket';
import { socketAuthMiddleware } from '../../src/collab/auth.middleware';
import { registerCollabHandlers, COLLAB_THROTTLE_MS } from '../../src/collab/socket';
import { signToken } from '../../src/utils/jwt';

type PresenceSync = { users: Array<{ userId: number; email: string; color: string }> };

describe('collab cursor + viewport sync', () => {
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

  function once<T>(socket: ClientSocket, event: string): Promise<T> {
    return new Promise((resolve) => socket.once(event, (data: T) => resolve(data)));
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const WAIT_MS = COLLAB_THROTTLE_MS + 80;

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

  it('valid cursor:move broadcasts to others with userId+color; sender excluded', async () => {
    const modelName = `model-${Date.now()}-cursor`;
    const modelId = Date.now();
    const s1 = await connectClient(1001, 'u1@test.com');
    const s2 = await connectClient(1002, 'u2@test.com');

    const s1SyncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelId, modelName });
    const s1Sync = await s1SyncP;
    const color1 = s1Sync.users.find((u) => u.userId === 1001)?.color;
    expect(typeof color1).toBe('string');

    const s2SyncP = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelId, modelName });
    await s2SyncP;

    let senderGotIt = false;
    s1.on('cursor:move', () => (senderGotIt = true));

    const recvP = once<{ userId: number; color: string; x: number; y: number }>(s2, 'cursor:move');
    s1.emit('cursor:move', { modelId, modelName, x: 10, y: 20 });

    const recv = await recvP;
    expect(recv).toEqual({ userId: 1001, color: color1 as string, x: 10, y: 20 });

    await delay(WAIT_MS);
    expect(senderGotIt).toBe(false);

    s1.close();
    s2.close();
  });

  it(`throttle: 10 rapid cursor:move in <${COLLAB_THROTTLE_MS}ms results in 1 broadcast (last payload wins)`, async () => {
    const modelName = `model-${Date.now()}-throttle`;
    const modelId = Date.now();
    const s1 = await connectClient(1101, 'u1101@test.com');
    const s2 = await connectClient(1102, 'u1102@test.com');

    const s1SyncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelId, modelName });
    await s1SyncP;

    const s2SyncP = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelId, modelName });
    await s2SyncP;

    const received: Array<{ x: number; y: number }> = [];
    s2.on('cursor:move', (p: { x: number; y: number }) => received.push({ x: p.x, y: p.y }));

    for (let i = 0; i < 10; i++) {
      s1.emit('cursor:move', { modelId, modelName, x: i, y: i + 1 });
    }

    await delay(WAIT_MS);

    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ x: 9, y: 10 });

    s1.close();
    s2.close();
  });

  it('valid viewport:update broadcasts to others; sender excluded', async () => {
    const modelName = `model-${Date.now()}-viewport`;
    const modelId = Date.now();
    const s1 = await connectClient(1201, 'u1201@test.com');
    const s2 = await connectClient(1202, 'u1202@test.com');

    const s1SyncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelId, modelName });
    await s1SyncP;

    const s2SyncP = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelId, modelName });
    await s2SyncP;

    let senderGotIt = false;
    s1.on('viewport:update', () => (senderGotIt = true));

    const recvP = once<{ userId: number; x: number; y: number; zoom: number }>(s2, 'viewport:update');
    s1.emit('viewport:update', { modelId, modelName, x: 1, y: 2, zoom: 3 });

    const recv = await recvP;
    expect(recv).toEqual({ userId: 1201, x: 1, y: 2, zoom: 3 });

    await delay(WAIT_MS);
    expect(senderGotIt).toBe(false);

    s1.close();
    s2.close();
  });

  it('invalid payload emits error:validation and does not broadcast', async () => {
    const modelName = `model-${Date.now()}-invalid`;
    const modelId = Date.now();
    const s1 = await connectClient(1301, 'u1301@test.com');
    const s2 = await connectClient(1302, 'u1302@test.com');

    const s1SyncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelId, modelName });
    await s1SyncP;

    const s2SyncP = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelId, modelName });
    await s2SyncP;

    const errors: string[] = [];
    s1.on('error:validation', (e: { message: string }) => errors.push(e.message));

    let cursorBroadcast = 0;
    let viewportBroadcast = 0;
    s2.on('cursor:move', () => cursorBroadcast++);
    s2.on('viewport:update', () => viewportBroadcast++);

    s1.emit('cursor:move', { modelId, modelName, y: 1 });
    s1.emit('viewport:update', { modelId, modelName, x: 1, y: 2 });
    s1.emit('cursor:move', { modelId, modelName, x: Infinity, y: 1 });

    await delay(WAIT_MS);

    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(cursorBroadcast).toBe(0);
    expect(viewportBroadcast).toBe(0);

    s1.close();
    s2.close();
  });

  it('stale socket after reconnect cannot broadcast into room', async () => {
    const modelName = `model-${Date.now()}-stale`;
    const modelId = Date.now();
    const uid = 1401;

    const oldSocket = await connectClient(uid, 'u1401@test.com');
    const other = await connectClient(1402, 'u1402@test.com');

    const oldSyncP = once<PresenceSync>(oldSocket, 'presence:sync');
    oldSocket.emit('room:join', { modelId, modelName });
    await oldSyncP;

    const otherSyncP = once<PresenceSync>(other, 'presence:sync');
    other.emit('room:join', { modelId, modelName });
    await otherSyncP;

    // Reconnect same user, which should replace the old socket entry.
    const fresh = await connectClient(uid, 'u1401@test.com');
    const freshSyncP = once<PresenceSync>(fresh, 'presence:sync');
    fresh.emit('room:join', { modelId, modelName });
    await freshSyncP;

    let cursorCount = 0;
    let viewportCount = 0;
    other.on('cursor:move', () => cursorCount++);
    other.on('viewport:update', () => viewportCount++);

    // Old socket tries to broadcast — should be ignored.
    oldSocket.emit('cursor:move', { modelId, modelName, x: 1, y: 2 });
    oldSocket.emit('viewport:update', { modelId, modelName, x: 3, y: 4, zoom: 5 });
    await delay(WAIT_MS);
    expect(cursorCount).toBe(0);
    expect(viewportCount).toBe(0);

    // Fresh socket should broadcast successfully.
    const cursorP = once<{ userId: number; x: number; y: number }>(other, 'cursor:move');
    fresh.emit('cursor:move', { modelId, modelName, x: 10, y: 20 });
    const cursor = await cursorP;
    expect(cursor.userId).toBe(uid);

    const viewportP = once<{ userId: number; x: number; y: number; zoom: number }>(other, 'viewport:update');
    fresh.emit('viewport:update', { modelId, modelName, x: 1, y: 2, zoom: 3 });
    const viewport = await viewportP;
    expect(viewport).toEqual({ userId: uid, x: 1, y: 2, zoom: 3 });

    oldSocket.close();
    fresh.close();
    other.close();
  });
});
