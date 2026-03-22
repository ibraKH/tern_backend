jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import http from 'http';
import type { Server } from 'socket.io';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';

import { initIo } from '../../src/socket';
import { socketAuthMiddleware } from '../../src/collab/auth.middleware';
import { registerCollabHandlers } from '../../src/collab/socket';
import { broadcastActivity } from '../../src/collab/roomManager';
import { signToken } from '../../src/utils/jwt';
import pool from '../../src/config/database';
import type { ActivityEntry } from '../../src/services/collab/activity.service';

type ActivityRecent = { activity: ActivityEntry[] };
type ActivityNew = { entry: ActivityEntry };
type PresenceSync = { users: Array<{ userId: number; email: string; color: string }> };

const FAKE_ENTRY: ActivityEntry = {
  id: 1,
  action: 'node_added',
  entityType: 'node',
  entityId: 10,
  detail: null,
  createdAt: '2026-01-15T12:00:00.000Z',
  user: { id: 42, email: 'alice@example.com' },
};

// Mock DB to return activity rows that match the service's expected column aliases.
function mockDbWithActivity(rows: Record<string, unknown>[] = []) {
  (pool.query as jest.Mock)
    .mockResolvedValueOnce({ rows: [{ id: 5 }] })   // model lookup
    .mockResolvedValueOnce({ rows });                 // activity query
}

function mockDbModelNotFound() {
  (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
}

describe('collab activity socket events', () => {
  let server: http.Server;
  let ioServer: Server;
  let port: number;
  let frontendUrl: string;
  let closeIo: (() => Promise<void>) | undefined;

  beforeAll((done) => {
    frontendUrl = 'http://localhost:5173';
    process.env.FRONTEND_URL = frontendUrl;

    server = http.createServer((_req, res) => res.end('ok'));
    ioServer = initIo(server, frontendUrl);
    ioServer.use(socketAuthMiddleware);
    registerCollabHandlers(ioServer);

    closeIo = () => new Promise<void>((resolve) => ioServer.close(() => resolve()));

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

  beforeEach(() => jest.clearAllMocks());

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

  // ── activity:recent on room:join ───────────────────────────────────

  it('joiner receives activity:recent with entries on room:join', async () => {
    const modelName = `act-model-${Date.now()}-1`;
    const token = signToken({ uid: 701, email: 'u701@test.com', role: 'Editor' });

    mockDbWithActivity([
      {
        id: 1,
        action: 'node_added',
        entityType: 'node',
        entityId: 10,
        detail: null,
        createdAt: '2026-01-15T12:00:00.000Z',
        userId: 42,
        userEmail: 'alice@example.com',
      },
    ]);

    const s = await connectClient(token);
    const activityP = once<ActivityRecent>(s, 'activity:recent');

    s.emit('room:join', { modelName });
    const result = await activityP;

    expect(result.activity).toHaveLength(1);
    expect(result.activity[0]).toMatchObject({
      id: 1,
      action: 'node_added',
      entityType: 'node',
      entityId: 10,
      createdAt: '2026-01-15T12:00:00.000Z',
      user: { id: 42, email: 'alice@example.com' },
    });

    s.close();
  });

  it('joiner receives empty activity when model has no history', async () => {
    const modelName = `act-model-${Date.now()}-2`;
    const token = signToken({ uid: 702, email: 'u702@test.com', role: 'Editor' });

    // Model exists but no activity rows
    mockDbWithActivity([]);

    const s = await connectClient(token);
    const activityP = once<ActivityRecent>(s, 'activity:recent');

    s.emit('room:join', { modelName });
    const result = await activityP;

    expect(result.activity).toEqual([]);

    s.close();
  });

  it('joiner receives empty activity when model is not found in DB', async () => {
    const modelName = `act-model-${Date.now()}-3`;
    const token = signToken({ uid: 703, email: 'u703@test.com', role: 'Editor' });

    mockDbModelNotFound();

    const s = await connectClient(token);
    const activityP = once<ActivityRecent>(s, 'activity:recent');

    s.emit('room:join', { modelName });
    const result = await activityP;

    expect(result.activity).toEqual([]);

    s.close();
  });

  it('activity:recent still emits empty array when DB throws', async () => {
    const modelName = `act-model-${Date.now()}-4`;
    const token = signToken({ uid: 704, email: 'u704@test.com', role: 'Editor' });

    (pool.query as jest.Mock).mockRejectedValueOnce(new Error('DB down'));

    const s = await connectClient(token);
    const activityP = once<ActivityRecent>(s, 'activity:recent');

    s.emit('room:join', { modelName });
    const result = await activityP;

    expect(result.activity).toEqual([]);

    s.close();
  });

  // ── broadcastActivity ──────────────────────────────────────────────

  it('broadcastActivity sends activity:new to all room members', async () => {
    const modelName = `act-model-${Date.now()}-5`;
    const token1 = signToken({ uid: 705, email: 'u705@test.com', role: 'Editor' });
    const token2 = signToken({ uid: 706, email: 'u706@test.com', role: 'Editor' });

    // Both joins will trigger getRecentActivity — mock DB for each
    mockDbModelNotFound();
    mockDbModelNotFound();

    const s1 = await connectClient(token1);
    const s2 = await connectClient(token2);

    // Join both clients to the same room
    const s1Sync = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelName });
    await s1Sync;

    const s2Sync = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelName });
    await s2Sync;

    // Both clients listen for the broadcast
    const s1Activity = once<ActivityNew>(s1, 'activity:new');
    const s2Activity = once<ActivityNew>(s2, 'activity:new');

    broadcastActivity(ioServer, modelName, FAKE_ENTRY);

    const [r1, r2] = await Promise.all([s1Activity, s2Activity]);

    expect(r1.entry).toMatchObject({ id: 1, action: 'node_added' });
    expect(r2.entry).toMatchObject({ id: 1, action: 'node_added' });

    s1.close();
    s2.close();
  });

  it('broadcastActivity does not reach sockets in a different room', async () => {
    const modelA = `act-model-${Date.now()}-6a`;
    const modelB = `act-model-${Date.now()}-6b`;
    const token1 = signToken({ uid: 707, email: 'u707@test.com', role: 'Editor' });
    const token2 = signToken({ uid: 708, email: 'u708@test.com', role: 'Editor' });

    mockDbModelNotFound();
    mockDbModelNotFound();

    const s1 = await connectClient(token1);
    const s2 = await connectClient(token2);

    const s1Sync = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelName: modelA });
    await s1Sync;

    const s2Sync = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelName: modelB });
    await s2Sync;

    let s2Received = false;
    s2.on('activity:new', () => (s2Received = true));

    broadcastActivity(ioServer, modelA, FAKE_ENTRY);

    await delay(150);
    expect(s2Received).toBe(false);

    s1.close();
    s2.close();
  });
});
