import { LOCK_TTL_SECONDS } from '../services/collab/locks.service';

interface CacheEntry {
  userId: number;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(modelName: string, entityType: string, entityId: number): string {
  return `${modelName}\x00${entityType}\x00${entityId}`;
}

export function cacheLock(
  modelName: string,
  entityType: string,
  entityId: number,
  userId: number,
): void {
  cache.set(cacheKey(modelName, entityType, entityId), {
    userId,
    expiresAt: Date.now() + LOCK_TTL_SECONDS * 1_000,
  });
}

export function evictLock(modelName: string, entityType: string, entityId: number): void {
  cache.delete(cacheKey(modelName, entityType, entityId));
}

export function evictLocksForUser(userId: number): void {
  for (const [k, entry] of cache) {
    if (entry.userId === userId) cache.delete(k);
  }
}

/**
 * Returns 'owned' | 'not_owner' on a valid cache hit, null on miss or expiry.
 * Callers must fall back to the DB on null.
 */
export function checkCache(
  modelName: string,
  entityType: string,
  entityId: number,
  userId: number,
): 'owned' | 'not_owner' | null {
  const k = cacheKey(modelName, entityType, entityId);
  const entry = cache.get(k);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(k);
    return null;
  }
  return entry.userId === userId ? 'owned' : 'not_owner';
}
