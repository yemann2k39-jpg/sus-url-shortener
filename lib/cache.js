/**
 * Tiny LRU cache with per-entry TTL.
 *
 * Map keeps insertion order: get() re-inserts to refresh recency, so the
 * oldest key is the least-recently-used one and is evicted first.
 * Pure JS - safe for edge and node runtimes alike.
 */
export function createCache({ max = 2000, ttlMs = 60000 } = {}) {
  const map = new Map();
  const stats = { hits: 0, misses: 0, evictions: 0, expiries: 0 };

  return {
    get(key) {
      const now = Date.now();
      const entry = map.get(key);
      if (!entry) {
        stats.misses += 1;
        return undefined;
      }
      if (now - entry.setAt >= ttlMs) {
        map.delete(key);
        stats.expiries += 1;
        stats.misses += 1;
        return undefined;
      }
      map.delete(key);
      map.set(key, entry); // refresh recency
      stats.hits += 1;
      return entry.value;
    },

    set(key, value) {
      const now = Date.now();
      if (map.has(key)) {
        map.delete(key);
      } else if (map.size >= max) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
        stats.evictions += 1;
      }
      map.set(key, { value, setAt: now });
    },

    del(key) {
      map.delete(key);
    },

    clear() {
      map.clear();
    },

    stats() {
      return { ...stats, size: map.size };
    },
  };
}
