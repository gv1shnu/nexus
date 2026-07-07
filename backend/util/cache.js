// Tiny in-process TTL cache so repeated queries don't re-hit every upstream.
// Intentionally dependency-free; swap for Redis when you need cross-process or
// multi-instance caching.
class TTLCache {
    constructor({ ttlMs = 5 * 60 * 1000, maxEntries = 500 } = {}) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.store = new Map(); // key -> { value, expires }
    }

    get(key) {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expires) {
            this.store.delete(key);
            return undefined;
        }
        // Refresh recency (Map preserves insertion order → cheap LRU).
        this.store.delete(key);
        this.store.set(key, entry);
        return entry.value;
    }

    set(key, value, ttlMs = this.ttlMs) {
        if (this.store.has(key)) this.store.delete(key);
        this.store.set(key, { value, expires: Date.now() + ttlMs });
        // Evict oldest entries past the cap.
        while (this.store.size > this.maxEntries) {
            const oldest = this.store.keys().next().value;
            this.store.delete(oldest);
        }
    }

    clear() {
        this.store.clear();
    }
}

module.exports = { TTLCache };
