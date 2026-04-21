import type { Server } from 'socket.io';

import { startLockCleanupJob, stopLockCleanupJob } from '../../../src/collab/lockCleanup';
import * as locksService from '../../../src/services/collab/locks.service';

jest.mock('../../../src/services/collab/locks.service');

const mockCleanupExpiredLocks = locksService.cleanupExpiredLocks as jest.Mock;

function makeMockIo() {
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  return { to, _emit: emit } as unknown as { to: jest.Mock; _emit: jest.Mock } & Server;
}

describe('lockCleanup (#43)', () => {
  let mockIo: ReturnType<typeof makeMockIo>;

  beforeEach(() => {
    jest.useFakeTimers();
    mockIo = makeMockIo();
    mockCleanupExpiredLocks.mockResolvedValue([]);
  });

  afterEach(() => {
    stopLockCleanupJob();
    jest.useRealTimers();
  });

  it('calls cleanupExpiredLocks after each 10-second tick', async () => {
    startLockCleanupJob(mockIo as unknown as Server);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(mockCleanupExpiredLocks).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(mockCleanupExpiredLocks).toHaveBeenCalledTimes(2);
  });

  it('emits lock:released to the correct room for each expired lock', async () => {
    const mockEmit = jest.fn();
    (mockIo.to as jest.Mock).mockReturnValue({ emit: mockEmit });
    mockCleanupExpiredLocks.mockResolvedValueOnce([
      { entityType: 'node', entityId: 5, modelName: 'M1' },
      { entityType: 'edge', entityId: 2, modelName: 'M2' },
    ]);

    startLockCleanupJob(mockIo as unknown as Server);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(mockIo.to).toHaveBeenCalledWith('name:M1');
    expect(mockIo.to).toHaveBeenCalledWith('name:M2');
    expect(mockEmit).toHaveBeenCalledTimes(2);
    expect(mockEmit).toHaveBeenCalledWith('lock:released', {
      entityType: 'node', entityId: 5, modelName: 'M1',
    });
    expect(mockEmit).toHaveBeenCalledWith('lock:released', {
      entityType: 'edge', entityId: 2, modelName: 'M2',
    });
  });

  it('does not crash the interval on a DB error — next tick still runs', async () => {
    mockCleanupExpiredLocks
      .mockRejectedValueOnce(new Error('DB down'))
      .mockResolvedValue([]);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    startLockCleanupJob(mockIo as unknown as Server);
    await jest.advanceTimersByTimeAsync(10_000); // first tick — fails
    await jest.advanceTimersByTimeAsync(10_000); // second tick — recovers

    expect(mockCleanupExpiredLocks).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[lockCleanup]'),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it('is idempotent — calling startLockCleanupJob twice creates only one interval', async () => {
    startLockCleanupJob(mockIo as unknown as Server);
    startLockCleanupJob(mockIo as unknown as Server); // second call is a no-op

    await jest.advanceTimersByTimeAsync(10_000);
    expect(mockCleanupExpiredLocks).toHaveBeenCalledTimes(1);
  });

  it('stopLockCleanupJob clears the interval so no further ticks fire', async () => {
    startLockCleanupJob(mockIo as unknown as Server);
    stopLockCleanupJob();

    await jest.advanceTimersByTimeAsync(30_000);
    expect(mockCleanupExpiredLocks).not.toHaveBeenCalled();
  });

  it('can be restarted after being stopped', async () => {
    startLockCleanupJob(mockIo as unknown as Server);
    stopLockCleanupJob();
    startLockCleanupJob(mockIo as unknown as Server); // fresh start

    await jest.advanceTimersByTimeAsync(10_000);
    expect(mockCleanupExpiredLocks).toHaveBeenCalledTimes(1);
  });
});
