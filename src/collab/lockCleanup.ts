import type { Server } from 'socket.io';

import { cleanupExpiredLocks } from '../services/collab/locks.service';

const CLEANUP_INTERVAL_MS = 10_000;

let intervalRef: ReturnType<typeof setInterval> | undefined;

/**
 * Periodically sweep expired editing locks and broadcast lock:released to affected rooms.
 * Errors are caught internally so the interval keeps running.
 */
export function startLockCleanupJob(io: Server): void {
  if (intervalRef) return;

  intervalRef = setInterval(async () => {
    try {
      const released = await cleanupExpiredLocks();
      for (const lock of released) {
        const roomKey = `name:${lock.modelName}`;
        io.to(roomKey).emit('lock:released', {
          entityType: lock.entityType,
          entityId: lock.entityId,
          modelName: lock.modelName,
        });
      }
    } catch (err) {
      console.error('[lockCleanup] tick failed:', err);
    }
  }, CLEANUP_INTERVAL_MS);
}

export function stopLockCleanupJob(): void {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
}
