jest.mock('../../src/services/collab/locks.service', () => ({
  acquireLock: jest.fn(),
  checkLockOwnership: jest.fn(),
  getPatchLockFailureReason: jest.fn(),
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
  checkLockOwnership,
  getPatchLockFailureReason,
} from '../../src/services/collab/locks.service';

type PresenceSync = { users: Array<{ userId: number; email: string; color: string }> };

describe('socket integration - entity:patch', () => {
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

  it('valid patch with active lock broadcasts to room excluding sender', async () => {
    (checkLockOwnership as jest.Mock).mockResolvedValue(true);

    const modelName = `model-${Date.now()}-entity-patch-ok`;
    const s1 = await connectClient(2401, 'u2401@test.com');
    const s2 = await connectClient(2402, 'u2402@test.com');

    const s1SyncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelName });
    await s1SyncP;

    const s2SyncP = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelName });
    await s2SyncP;

    const broadcastP = once<{
      entityType: 'node' | 'edge';
      entityId: number;
      field: string;
      value: unknown;
      userId: number;
    }>(s2, 'entity:patch');

    let senderReceived = false;
    s1.on('entity:patch', () => {
      senderReceived = true;
    });

    s1.emit('entity:patch', {
      entityType: 'node',
      entityId: 42,
      field: 'label',
      value: 'patched',
      modelName,
    });

    const broadcast = await broadcastP;
    expect(broadcast).toEqual({
      entityType: 'node',
      entityId: 42,
      field: 'label',
      value: 'patched',
      userId: 2401,
    });

    await delay(50);
    expect(senderReceived).toBe(false);

    s1.close();
    s2.close();
  });

  it('no lock held emits error:patch lock_required only to sender', async () => {
    (checkLockOwnership as jest.Mock).mockResolvedValue(false);
    (getPatchLockFailureReason as jest.Mock).mockResolvedValue('lock_required');

    const modelName = `model-${Date.now()}-entity-patch-no-lock`;
    const s1 = await connectClient(2501, 'u2501@test.com');
    const s2 = await connectClient(2502, 'u2502@test.com');

    const s1SyncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelName });
    await s1SyncP;

    const s2SyncP = once<PresenceSync>(s2, 'presence:sync');
    s2.emit('room:join', { modelName });
    await s2SyncP;

    let watcherReceived = false;
    s2.on('entity:patch', () => {
      watcherReceived = true;
    });

    const errorP = once<{ reason: string }>(s1, 'error:patch');
    s1.emit('entity:patch', {
      entityType: 'edge',
      entityId: 51,
      field: 'condition',
      value: 'x > 1',
      modelName,
    });

    const error = await errorP;
    expect(error).toEqual({ reason: 'lock_required' });

    await delay(50);
    expect(watcherReceived).toBe(false);

    s1.close();
    s2.close();
  });

  it('different lock owner emits error:patch not_owner', async () => {
    (checkLockOwnership as jest.Mock).mockResolvedValue(false);
    (getPatchLockFailureReason as jest.Mock).mockResolvedValue('not_owner');

    const modelName = `model-${Date.now()}-entity-patch-not-owner`;
    const s1 = await connectClient(2601, 'u2601@test.com');

    const s1SyncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelName });
    await s1SyncP;

    const errorP = once<{ reason: string }>(s1, 'error:patch');
    s1.emit('entity:patch', {
      entityType: 'node',
      entityId: 61,
      field: 'name',
      value: 'Changed',
      modelName,
    });

    const error = await errorP;
    expect(error).toEqual({ reason: 'not_owner' });

    s1.close();
  });

  it('expired lock emits error:patch lock_expired', async () => {
    (checkLockOwnership as jest.Mock).mockResolvedValue(false);
    (getPatchLockFailureReason as jest.Mock).mockResolvedValue('lock_expired');

    const modelName = `model-${Date.now()}-entity-patch-expired`;
    const s1 = await connectClient(2701, 'u2701@test.com');

    const s1SyncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelName });
    await s1SyncP;

    const errorP = once<{ reason: string }>(s1, 'error:patch');
    s1.emit('entity:patch', {
      entityType: 'edge',
      entityId: 71,
      field: 'weight',
      value: 5,
      modelName,
    });

    const error = await errorP;
    expect(error).toEqual({ reason: 'lock_expired' });

    s1.close();
  });

  it('missing field emits error:validation', async () => {
    const modelName = `model-${Date.now()}-entity-patch-validation`;
    const s1 = await connectClient(2801, 'u2801@test.com');

    const errorP = once<{ message: string }>(s1, 'error:validation');
    s1.emit('entity:patch', {
      entityType: 'node',
      entityId: 81,
      value: 'ok',
      modelName,
    });

    const error = await errorP;
    expect(error.message).toContain('field');

    s1.close();
  });

  it('undefined value emits error:validation after joining room', async () => {
    const modelName = `model-${Date.now()}-entity-patch-undefined`;
    const s1 = await connectClient(2802, 'u2802@test.com');

    const syncP = once<PresenceSync>(s1, 'presence:sync');
    s1.emit('room:join', { modelName });
    await syncP;

    const errorP = once<{ message: string }>(s1, 'error:validation');
    s1.emit('entity:patch', {
      entityType: 'node',
      entityId: 82,
      field: 'title',
      modelName,
    });

    const error = await errorP;
    expect(error.message).toContain('JSON-serializable');

    s1.close();
  });

  it('patching a room the socket has not joined emits error:validation', async () => {
    const modelName = `model-${Date.now()}-entity-patch-room`;
    const s1 = await connectClient(2803, 'u2803@test.com');

    const errorP = once<{ message: string }>(s1, 'error:validation');
    s1.emit('entity:patch', {
      entityType: 'node',
      entityId: 83,
      field: 'title',
      value: 'ok',
      modelName,
    });

    const error = await errorP;
    expect(error.message).toContain('joining the model room');

    s1.close();
  });
});
