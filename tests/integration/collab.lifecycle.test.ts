import http from 'http';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';

import { initIo } from '../../src/socket';
import { socketAuthMiddleware } from '../../src/collab/auth.middleware';
import { registerCollabHandlers } from '../../src/collab/socket';
import { signToken } from '../../src/utils/jwt';

type PresenceSync = { users: Array<{ userId: number; email: string; color: string }> };

describe('collab room lifecycle', () => {
  let server: http.Server;
  let port: number;
  let frontendUrl: string;
  let closeIo: (() => Promise<void>) | undefined;

  beforeAll((done) => {
    frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
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

  function connectClient(token: string): Promise<ClientSocket> {
    const url = `http://localhost:${port}`;

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

  function once<T>(socket: ClientSocket, event: string): Promise<T> {
    return new Promise((resolve) => socket.once(event, (data: T) => resolve(data)));
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it('first user joins: receives presence:sync (1 user), no presence:join', async () => {
    const modelName = `model-${Date.now()}-1`;
    const modelId = Date.now();
    const token1 = signToken({ uid: 101, email: 'u101@test.com', role: 'Editor' });

    const s1 = await connectClient(token1);

    const joinPromise = once<PresenceSync>(s1, 'presence:sync');
    let joinBroadcast = 0;
    s1.on('presence:join', () => joinBroadcast++);

    s1.emit('room:join', { modelId, modelName });
    const sync = await joinPromise;

    expect(sync.users).toHaveLength(1);
    expect(sync.users[0]).toMatchObject({ userId: 101, email: 'u101@test.com' });

    await delay(100);
    expect(joinBroadcast).toBe(0);

    s1.close();
  });

  it('second user joins: first gets presence:join; new gets presence:sync (2 users)', async () => {
    const modelName = `model-${Date.now()}-2`;
    const modelId = Date.now();
    const token1 = signToken({ uid: 201, email: 'u201@test.com', role: 'Editor' });
    const token2 = signToken({ uid: 202, email: 'u202@test.com', role: 'Editor' });

    const s1 = await connectClient(token1);
    const s2 = await connectClient(token2);

    const s1Sync1 = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelId, modelName });
    await s1Sync1;

    const joinEvent = once<{ user: { userId: number } }>(s1, 'presence:join');
    const s2Sync = once<PresenceSync>(s2, 'presence:sync');

    s2.emit('room:join', { modelId, modelName });

    const [joinPayload, sync2] = await Promise.all([joinEvent, s2Sync]);

    expect(joinPayload.user.userId).toBe(202);
    expect(sync2.users).toHaveLength(2);

    s1.close();
    s2.close();
  });

  it('disconnect broadcasts presence:leave to remaining users', async () => {
    const modelName = `model-${Date.now()}-3`;
    const modelId = Date.now();
    const token1 = signToken({ uid: 301, email: 'u301@test.com', role: 'Editor' });
    const token2 = signToken({ uid: 302, email: 'u302@test.com', role: 'Editor' });

    const s1 = await connectClient(token1);
    const s2 = await connectClient(token2);

    const s1Sync = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelId, modelName });
    await s1Sync;

    const s2Sync = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelId, modelName });
    await s2Sync;

    const leaveEvent = once<{ userId: number }>(s1, 'presence:leave');
    s2.close();

    const leave = await leaveEvent;
    expect(leave).toEqual({ userId: 302 });

    s1.close();
  });

  it('reconnect replaces socket entry; no duplicates in presence:sync', async () => {
    const modelName = `model-${Date.now()}-4`;
    const modelId = Date.now();
    const token = signToken({ uid: 401, email: 'u401@test.com', role: 'Editor' });

    const s1 = await connectClient(token);
    const sync1P = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelId, modelName });
    const sync1 = await sync1P;
    expect(sync1.users).toHaveLength(1);

    const s2 = await connectClient(token);
    const sync2P = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelId, modelName });
    const sync2 = await sync2P;

    expect(sync2.users).toHaveLength(1);
    expect(sync2.users[0].userId).toBe(401);
    expect((sync2.users[0] as any).socketId).toBeUndefined();

    s1.close();
    s2.close();
  });

  it('same modelName but different modelId does not share rooms', async () => {
    const modelName = `same-name-${Date.now()}`;
    const token1 = signToken({ uid: 601, email: 'u601@test.com', role: 'Editor' });
    const token2 = signToken({ uid: 602, email: 'u602@test.com', role: 'Editor' });

    const s1 = await connectClient(token1);
    const s2 = await connectClient(token2);

    const s1Sync = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelId: 6001, modelName });
    await s1Sync;

    let s1JoinBroadcast = 0;
    s1.on('presence:join', () => s1JoinBroadcast++);

    const s2Sync = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelId: 6002, modelName });
    const sync2 = await s2Sync;

    expect(sync2.users).toHaveLength(1);
    expect(sync2.users[0].userId).toBe(602);

    await delay(100);
    expect(s1JoinBroadcast).toBe(0);

    s1.close();
    s2.close();
  });

  it('room:join with invalid modelName emits error:validation and does nothing else', async () => {
    const token = signToken({ uid: 501, email: 'u501@test.com', role: 'Editor' });
    const s = await connectClient(token);

    const errorP = once<{ message: string }>(s, 'error:validation');
    let syncReceived = false;
    s.on('presence:sync', () => (syncReceived = true));

    s.emit('room:join', { modelName: '' });
    const err = await errorP;

    expect(err.message).toMatch(/modelId|modelName/i);

    await delay(100);
    expect(syncReceived).toBe(false);

    s.close();
  });
});
