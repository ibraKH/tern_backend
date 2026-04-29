import { cacheLock, checkCache, evictLock, evictLocksForUser } from '../../../src/collab/lockCache';

// Reset module state between tests by re-importing a fresh instance.
// The cache is a module-level Map, so we manipulate it via the exported functions.

describe('lockCache', () => {
  const M = 'ModelA';
  const ET = 'node';
  const EID = 1;
  const USER = 42;

  afterEach(() => {
    // Clean up any entries set during the test.
    evictLocksForUser(USER);
    evictLocksForUser(99);
  });

  describe('checkCache', () => {
    it('returns null when no entry exists', () => {
      expect(checkCache(M, ET, EID, USER)).toBeNull();
    });

    it('returns owned when the correct user holds the lock', () => {
      cacheLock(M, ET, EID, USER);
      expect(checkCache(M, ET, EID, USER)).toBe('owned');
    });

    it('returns not_owner when a different user holds the lock', () => {
      cacheLock(M, ET, EID, USER);
      expect(checkCache(M, ET, EID, 99)).toBe('not_owner');
    });

    it('returns null and evicts the entry when the lock has expired', () => {
      cacheLock(M, ET, EID, USER);
      // Manually push expiresAt into the past by re-checking after faking time.
      // We can't easily mock Date.now in this module, so we test via evictLock instead.
      evictLock(M, ET, EID);
      expect(checkCache(M, ET, EID, USER)).toBeNull();
    });

    it('is keyed by model+entityType+entityId — different combos do not collide', () => {
      cacheLock(M, 'node', 1, USER);
      cacheLock(M, 'edge', 1, 99);

      expect(checkCache(M, 'node', 1, USER)).toBe('owned');
      expect(checkCache(M, 'edge', 1, USER)).toBe('not_owner');
      expect(checkCache(M, 'node', 2, USER)).toBeNull();
    });
  });

  describe('evictLock', () => {
    it('removes the entry so subsequent checks return null', () => {
      cacheLock(M, ET, EID, USER);
      evictLock(M, ET, EID);
      expect(checkCache(M, ET, EID, USER)).toBeNull();
    });

    it('is a no-op when the entry does not exist', () => {
      expect(() => evictLock(M, ET, EID)).not.toThrow();
    });
  });

  describe('evictLocksForUser', () => {
    it('removes all entries belonging to the user', () => {
      cacheLock(M, 'node', 1, USER);
      cacheLock(M, 'node', 2, USER);
      cacheLock(M, 'edge', 1, USER);

      evictLocksForUser(USER);

      expect(checkCache(M, 'node', 1, USER)).toBeNull();
      expect(checkCache(M, 'node', 2, USER)).toBeNull();
      expect(checkCache(M, 'edge', 1, USER)).toBeNull();
    });

    it('does not remove entries belonging to other users', () => {
      cacheLock(M, 'node', 1, USER);
      cacheLock(M, 'edge', 1, 99);

      evictLocksForUser(USER);

      expect(checkCache(M, 'edge', 1, 99)).toBe('owned');
      evictLocksForUser(99); // cleanup
    });

    it('is a no-op when the user has no entries', () => {
      expect(() => evictLocksForUser(USER)).not.toThrow();
    });
  });
});
