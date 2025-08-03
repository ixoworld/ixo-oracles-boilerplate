/**
 * Simple, fast hash function to detect event changes
 * Returns consistent hash for same event data
 */
export function hashEvent(event: unknown): string {
  try {
    // Convert to stable string representation
    const str = stableStringify(event);

    // Simple FNV-1a hash
    let hash = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193); // FNV prime
    }

    // Return as unsigned 32-bit hex
    return (hash >>> 0).toString(16).padStart(8, '0');
  } catch (error) {
    // Fallback for problematic inputs
    return '00000000';
  }
}

/**
 * Creates a stable string representation of any value
 */
function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const type = typeof value;

  if (type === 'boolean' || type === 'number') {
    return String(value);
  }

  if (type === 'string') {
    return `"${value}"`; // Quote strings to differentiate from other types
  }

  if (type === 'bigint') {
    return `${value}n`;
  }

  if (type === 'function') {
    return '[Function]';
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value instanceof Date) {
    return `Date(${value.getTime()})`;
  }

  if (type === 'object') {
    // Handle circular references
    const seen = new WeakSet();

    function processObject(obj: any): string {
      if (seen.has(obj)) return '[Circular]';
      seen.add(obj);

      const keys = Object.keys(obj).sort(); // Stable key order
      const pairs = keys.map((key) => `${key}:${stableStringify(obj[key])}`);
      return `{${pairs.join(',')}}`;
    }

    return processObject(value);
  }

  return String(value);
}
