import type { Server, Socket } from 'socket.io';
import { registerCollabHandlers } from '../../../../src/collab/socket';
import {
  acquireLock,
  checkLockOwnership,
  getPatchLockFailureReason,
  releaseAllLocksForSocket,
  releaseLock,
} from '../../../../src/services/collab/locks.service';
import {
  getRoom,
  getUserColor,
  joinRoom,
  leaveRoom,
} from '../../../../src/collab/roomManager';

jest.mock('../../../../src/services/collab/locks.service', () => ({
  acquireLock: jest.fn(),
  checkLockOwnership: jest.fn(),
  getPatchLockFailureReason: jest.fn(),
  releaseLock: jest.fn(),
  releaseAllLocksForSocket: jest.fn(),
}));

jest.mock('../../../../src/collab/roomManager', () => ({
  getRoom: jest.fn(),
  getUserColor: jest.fn(),
  joinRoom: jest.fn(),
  leaveRoom: jest.fn(),
}));

type Handler = (payload?: unknown) => void;

type TestUser = {
  uid: number;
  email: string;
  role: string;
};

type MockSocket = {
  id: string;
  data: { user: TestUser };
  rooms: Set<string>;
  on: jest.Mock;
  emit: jest.Mock;
  to: jest.Mock;
};

type MockIo = {
  on: jest.Mock;
  to: jest.Mock;
  sockets: {
    sockets: Map<string, unknown>;
  };
};

function createSocket(
  user: TestUser = { uid: 1, email: 'u1@test.com', role: 'Editor' }
): {
  socket: MockSocket;
  handlers: Map<string, Handler>;
  trigger: (event: string, payload?: unknown) => void;
} {
  const handlers = new Map<string, Handler>();

  const socket = {} as MockSocket;

  socket.id = 'socket-1';
  socket.data = { user };
  socket.rooms = new Set<string>(['socket-1']);
  socket.on = jest.fn((event: string, handler: Handler) => {
    handlers.set(event, handler);
    return socket;
  });
  socket.emit = jest.fn();
  socket.to = jest.fn(() => ({
    emit: jest.fn(),
  }));

  return {
    socket,
    handlers,
    trigger(event: string, payload?: unknown) {
      const handler = handlers.get(event);
      if (!handler) {
        throw new Error(`Missing handler for ${event}`);
      }
      handler(payload);
    },
  };
}

function createIo(): {
  io: MockIo;
  connect: (socket: unknown) => void;
} {
  const connectionHandlers: Handler[] = [];

  const io = {} as MockIo;

  io.on = jest.fn((event: string, handler: Handler) => {
    if (event === 'connection') {
      connectionHandlers.push(handler);
    }
    return io;
  });

  io.to = jest.fn(() => ({
    emit: jest.fn(),
  }));

  io.sockets = {
    sockets: new Map(),
  };

  return {
    io,
    connect(socket: unknown) {
      for (const handler of connectionHandlers) {
        handler(socket);
      }
    },
  };
}

describe('collab/socket unit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers lock:acquire and broadcasts lock:acquired on success', async () => {
    const { io, connect } = createIo();
    const { socket, trigger } = createSocket({
      uid: 10,
      email: 'u10@test.com',
      role: 'Editor',
    });
    const roomBroadcast = { emit: jest.fn() };

    (getRoom as jest.Mock).mockReturnValue({
      users: new Map([['10', { userId: 10, color: '#123456' }]]),
      socketIdByUserId: new Map([['10', 'socket-1']]),
    });
    (getUserColor as jest.Mock).mockReturnValue('#123456');
    (acquireLock as jest.Mock).mockResolvedValue({ success: true });
    socket.to = jest.fn(() => roomBroadcast);

    socket.rooms.add('name:Model A');

    registerCollabHandlers(io as unknown as Server);
    connect(socket as unknown as Socket);

    trigger('lock:acquire', {
      entityType: 'node',
      entityId: '42',
      modelName: 'Model A',
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(acquireLock).toHaveBeenCalledWith({
      entityType: 'node',
      entityId: 42,
      modelName: 'Model A',
      userId: 10,
    });

    expect(socket.emit).toHaveBeenCalledWith('lock:ack', {
      entityType: 'node',
      entityId: 42,
      userId: 10,
      color: '#123456',
    });
    expect(socket.to).toHaveBeenCalledWith('name:Model A');
    expect(roomBroadcast.emit).toHaveBeenCalledWith('lock:acquired', {
      entityType: 'node',
      entityId: 42,
      userId: 10,
      color: '#123456',
    });
  });

  it('lock:acquire emits lock:denied when service rejects ownership', async () => {
    const { io, connect } = createIo();
    const { socket, trigger } = createSocket({
      uid: 20,
      email: 'u20@test.com',
      role: 'Editor',
    });

    (getRoom as jest.Mock).mockReturnValue({
      users: new Map([['20', { userId: 20, color: '#ff0000' }]]),
      socketIdByUserId: new Map([['20', 'socket-1']]),
    });
    (acquireLock as jest.Mock).mockResolvedValue({
      success: false,
      heldBy: 'owner@example.com',
    });

    socket.rooms.add('name:Model B');

    registerCollabHandlers(io as unknown as Server);
    connect(socket as unknown as Socket);

    trigger('lock:acquire', {
      entityType: 'edge',
      entityId: 99,
      modelName: 'Model B',
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(socket.emit).toHaveBeenCalledWith('lock:denied', {
      entityType: 'edge',
      entityId: 99,
      heldBy: 'owner@example.com',
    });
  });

  it('lock:acquire emits validation error when socket has not joined the room', () => {
    const { io, connect } = createIo();
    const { socket, trigger } = createSocket({
      uid: 30,
      email: 'u30@test.com',
      role: 'Editor',
    });

    registerCollabHandlers(io as unknown as Server);
    connect(socket as unknown as Socket);

    trigger('lock:acquire', {
      entityType: 'node',
      entityId: 1,
      modelName: 'Model C',
    });

    expect(socket.emit).toHaveBeenCalledWith('error:validation', {
      message: 'lock:acquire requires joining the model room first',
    });

    expect(acquireLock).not.toHaveBeenCalled();
  });

  it('lock:release broadcasts lock:released when delete succeeds', async () => {
    const { io, connect } = createIo();
    const { socket, trigger } = createSocket({
      uid: 40,
      email: 'u40@test.com',
      role: 'Editor',
    });
    const roomBroadcast = { emit: jest.fn() };

    (getRoom as jest.Mock).mockReturnValue({
      users: new Map([['40', { userId: 40, color: '#00ff00' }]]),
      socketIdByUserId: new Map([['40', 'socket-1']]),
    });
    (releaseLock as jest.Mock).mockResolvedValue(1);
    (io.to as jest.Mock).mockReturnValue(roomBroadcast);

    socket.rooms.add('name:Model D');

    registerCollabHandlers(io as unknown as Server);
    connect(socket as unknown as Socket);

    trigger('lock:release', {
      entityType: 'edge',
      entityId: '777',
      modelName: 'Model D',
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(releaseLock).toHaveBeenCalledWith({
      entityType: 'edge',
      entityId: 777,
      modelName: 'Model D',
      userId: 40,
    });

    expect(roomBroadcast.emit).toHaveBeenCalledWith('lock:released', {
      entityType: 'edge',
      entityId: 777,
    });
  });

  it('lock:refresh re-acquires the lock and acknowledges the sender', async () => {
    const { io, connect } = createIo();
    const { socket, trigger } = createSocket({
      uid: 41,
      email: 'u41@test.com',
      role: 'Editor',
    });

    (getRoom as jest.Mock).mockReturnValue({
      users: new Map([['41', { userId: 41, color: '#00aa00' }]]),
      socketIdByUserId: new Map([['41', 'socket-1']]),
    });
    (getUserColor as jest.Mock).mockReturnValue('#00aa00');
    (acquireLock as jest.Mock).mockResolvedValue({ success: true });

    socket.rooms.add('name:Model Refresh');

    registerCollabHandlers(io as unknown as Server);
    connect(socket as unknown as Socket);

    trigger('lock:refresh', {
      entityType: 'node',
      entityId: '900',
      modelName: 'Model Refresh',
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(acquireLock).toHaveBeenCalledWith({
      entityType: 'node',
      entityId: 900,
      modelName: 'Model Refresh',
      modelId: undefined,
      userId: 41,
    });

    expect(socket.emit).toHaveBeenCalledWith('lock:ack', {
      entityType: 'node',
      entityId: 900,
      userId: 41,
      color: '#00aa00',
    });
  });

  it('disconnecting releases only locks for rooms actively owned by the socket', async () => {
    const { io, connect } = createIo();
    const { socket, trigger } = createSocket({
      uid: 50,
      email: 'u50@test.com',
      role: 'Editor',
    });

    const roomX = { emit: jest.fn() };
    const roomY = { emit: jest.fn() };

    (releaseAllLocksForSocket as jest.Mock).mockResolvedValue([
      { modelId: 501, entityType: 'node', entityId: 1, modelName: 'Model X' },
    ]);

    (leaveRoom as jest.Mock).mockResolvedValue(undefined);
    (io.to as jest.Mock).mockImplementation((roomKey: string) => {
      if (roomKey === 'name:Model X') return roomX;
      if (roomKey === 'name:Model Y') return roomY;
      return { emit: jest.fn() };
    });

    socket.rooms.add('name:Model X');
    socket.rooms.add('name:Model Y');
    (getRoom as jest.Mock).mockImplementation((roomKey: string) => {
      if (roomKey === 'name:Model X') {
        return {
          modelName: 'Model X',
          socketIdByUserId: new Map([['50', 'socket-1']]),
        };
      }

      if (roomKey === 'name:Model Y') {
        return {
          modelName: 'Model Y',
          socketIdByUserId: new Map([['50', 'socket-2']]),
        };
      }

      return undefined;
    });

    registerCollabHandlers(io as unknown as Server);
    connect(socket as unknown as Socket);

    trigger('disconnecting');

    await Promise.resolve();
    await Promise.resolve();

    expect(releaseAllLocksForSocket).toHaveBeenCalledWith(50, {
      modelIds: [],
      modelNames: ['Model X'],
    });

    expect(roomX.emit).toHaveBeenCalledWith('lock:released', {
      entityType: 'node',
      entityId: 1,
    });

    expect(roomY.emit).not.toHaveBeenCalled();
  });

  it('room:join delegates to joinRoom and emits presence events', async () => {
    const { io, connect } = createIo();
    const { socket, trigger } = createSocket({
      uid: 60,
      email: 'u60@test.com',
      role: 'Editor',
    });

    (joinRoom as jest.Mock).mockResolvedValue({
      userId: 60,
      email: 'u60@test.com',
      color: '#abcdef',
    });

    (getRoom as jest.Mock).mockReturnValue({
      users: new Map([
        ['60', { userId: 60, email: 'u60@test.com', color: '#abcdef' }],
      ]),
    });

    const roomEmitter = { emit: jest.fn() };
    socket.to = jest.fn(() => roomEmitter);

    registerCollabHandlers(io as unknown as Server);
    connect(socket as unknown as Socket);

    trigger('room:join', { modelName: 'Model Join' });

    await Promise.resolve();
    await Promise.resolve();

    expect(joinRoom).toHaveBeenCalledWith(
      io,
      socket,
      'name:Model Join',
      'Model Join'
    );
    expect(socket.emit).toHaveBeenCalledWith('presence:sync', {
      users: [{ userId: 60, email: 'u60@test.com', color: '#abcdef' }],
    });
    expect(roomEmitter.emit).toHaveBeenCalledWith('presence:join', {
      user: { userId: 60, email: 'u60@test.com', color: '#abcdef' },
    });
  });

  it('entity:patch broadcasts to room excluding sender when lock ownership is confirmed', async () => {
    const { io, connect } = createIo();
    const { socket, trigger } = createSocket({
      uid: 70,
      email: 'u70@test.com',
      role: 'Editor',
    });
    const roomBroadcast = { emit: jest.fn() };

    (getRoom as jest.Mock).mockReturnValue({
      users: new Map([['70', { userId: 70, color: '#123123' }]]),
      socketIdByUserId: new Map([['70', 'socket-1']]),
    });
    (checkLockOwnership as jest.Mock).mockResolvedValue(true);
    socket.to = jest.fn(() => roomBroadcast);
    socket.rooms.add('name:Model Patch');

    registerCollabHandlers(io as unknown as Server);
    connect(socket as unknown as Socket);

    trigger('entity:patch', {
      entityType: 'node',
      entityId: '42',
      field: 'label',
      value: { text: 'next' },
      modelName: 'Model Patch',
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(checkLockOwnership).toHaveBeenCalledWith({
      entityType: 'node',
      entityId: 42,
      modelName: 'Model Patch',
      userId: 70,
    });
    expect(socket.to).toHaveBeenCalledWith('name:Model Patch');
    expect(roomBroadcast.emit).toHaveBeenCalledWith('entity:patch', {
      entityType: 'node',
      entityId: 42,
      field: 'label',
      value: { text: 'next' },
      userId: 70,
    });
    expect(socket.emit).not.toHaveBeenCalledWith('entity:patch', expect.anything());
  });

  it('entity:patch emits lock_required when no lock is held', async () => {
    const { io, connect } = createIo();
    const { socket, trigger } = createSocket({
      uid: 71,
      email: 'u71@test.com',
      role: 'Editor',
    });

    (getRoom as jest.Mock).mockReturnValue({
      users: new Map([['71', { userId: 71, color: '#123123' }]]),
      socketIdByUserId: new Map([['71', 'socket-1']]),
    });
    (checkLockOwnership as jest.Mock).mockResolvedValue(false);
    (getPatchLockFailureReason as jest.Mock).mockResolvedValue('lock_required');
    socket.rooms.add('name:Model Patch');

    registerCollabHandlers(io as unknown as Server);
    connect(socket as unknown as Socket);

    trigger('entity:patch', {
      entityType: 'edge',
      entityId: 43,
      field: 'guard',
      value: 'x',
      modelName: 'Model Patch',
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(socket.emit).toHaveBeenCalledWith('error:patch', {
      reason: 'lock_required',
    });
  });

  it('entity:patch emits not_owner and lock_expired reasons from lock service', async () => {
    const { io, connect } = createIo();
    const { socket, trigger } = createSocket({
      uid: 72,
      email: 'u72@test.com',
      role: 'Editor',
    });

    (getRoom as jest.Mock).mockReturnValue({
      users: new Map([['72', { userId: 72, color: '#123123' }]]),
      socketIdByUserId: new Map([['72', 'socket-1']]),
    });
    (checkLockOwnership as jest.Mock).mockResolvedValue(false);
    (getPatchLockFailureReason as jest.Mock)
      .mockResolvedValueOnce('not_owner')
      .mockResolvedValueOnce('lock_expired');
    socket.rooms.add('name:Model Patch');

    registerCollabHandlers(io as unknown as Server);
    connect(socket as unknown as Socket);

    trigger('entity:patch', {
      entityType: 'node',
      entityId: 44,
      field: 'name',
      value: 'v1',
      modelName: 'Model Patch',
    });

    await Promise.resolve();
    await Promise.resolve();

    trigger('entity:patch', {
      entityType: 'node',
      entityId: 44,
      field: 'name',
      value: 'v2',
      modelName: 'Model Patch',
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(socket.emit).toHaveBeenCalledWith('error:patch', { reason: 'not_owner' });
    expect(socket.emit).toHaveBeenCalledWith('error:patch', { reason: 'lock_expired' });
  });

  it('entity:patch emits validation errors for missing field, undefined value, and missing room membership', () => {
    const { io, connect } = createIo();
    const { socket, trigger } = createSocket({
      uid: 73,
      email: 'u73@test.com',
      role: 'Editor',
    });

    registerCollabHandlers(io as unknown as Server);
    connect(socket as unknown as Socket);

    trigger('entity:patch', {
      entityType: 'node',
      entityId: 45,
      value: 'v1',
      modelName: 'Model Patch',
    });

    expect(socket.emit).toHaveBeenCalledWith('error:validation', {
      message: 'field must be a non-empty string',
    });

    trigger('entity:patch', {
      entityType: 'node',
      entityId: 45,
      field: 'title',
      value: 'v1',
      modelName: 'Model Patch',
    });

    expect(socket.emit).toHaveBeenCalledWith('error:validation', {
      message: 'entity:patch requires joining the model room first',
    });

    socket.rooms.add('name:Model Patch');
    (getRoom as jest.Mock).mockReturnValue({
      users: new Map([['73', { userId: 73, color: '#123123' }]]),
      socketIdByUserId: new Map([['73', 'socket-1']]),
    });

    trigger('entity:patch', {
      entityType: 'node',
      entityId: 45,
      field: 'title',
      value: undefined,
      modelName: 'Model Patch',
    });

    expect(socket.emit).toHaveBeenCalledWith('error:validation', {
      message: 'value must be JSON-serializable and cannot be undefined',
    });
  });
});
