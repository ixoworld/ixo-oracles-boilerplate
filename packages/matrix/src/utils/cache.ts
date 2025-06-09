/**
 * Simple cache with TTL support
 */
interface ICacheEntry {
  value: string;
  timestamp: number;
}

export class Cache {
  private cache = new Map<string, ICacheEntry>();
  private readonly maxSize: number;
  private readonly ttl: number;

  constructor(maxSize = 1000, ttlMs = 30 * 60 * 1000) {
    // 30 minutes default
    this.maxSize = maxSize;
    this.ttl = ttlMs;
  }

  get(key: string): string | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: string): void {
    // Remove oldest if at max size
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
