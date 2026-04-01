/**
 * Shared URL normalization and deduplication utilities.
 * Used by both mcp-agent.ts and main-agent config MCP server handling.
 */

/**
 * Normalise a URL for comparison.
 * Only lowercases scheme + hostname (paths are case-sensitive per RFC).
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    // Trim trailing slash from pathname only if it's just "/"
    if (parsed.pathname === '/') parsed.pathname = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    // Fallback for non-parseable URLs
    return url.replace(/\/+$/, '').toLowerCase();
  }
}

/** Deduplicate an array of URL strings (first occurrence wins). */
export function deduplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls.filter((url) => {
    const norm = normalizeUrl(url);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

/**
 * Derive a human-readable, unique server name from a URL.
 * Uses hostname + pathname, slugified (e.g. "mcp-memory-engine.devnet.ixo.earth/"
 * → "mcp-memory-engine_devnet_ixo_earth"). Appends a numeric suffix when the
 * same base name appears more than once in `existing`.
 */
export function urlToServerName(
  url: string,
  existing: Set<string> = new Set(),
): string {
  try {
    const parsed = new URL(url);
    // hostname + meaningful path segments, drop empty and trailing slashes
    const parts = [
      parsed.hostname,
      ...parsed.pathname.split('/').filter(Boolean),
    ];
    const base = parts
      .join('_')
      .replace(/[^a-zA-Z0-9_-]/g, '_') // replace non-alphanumeric
      .replace(/_+/g, '_') // collapse consecutive underscores
      .replace(/^_|_$/g, ''); // trim leading/trailing underscores

    let name = base || 'mcp';
    let i = 2;
    while (existing.has(name)) {
      name = `${base}_${i++}`;
    }
    existing.add(name);
    return name;
  } catch {
    // Fallback for unparseable URLs
    const fallback = `mcp_${existing.size}`;
    existing.add(fallback);
    return fallback;
  }
}

/** Deduplicate an array of objects with a `url` field (first occurrence wins). */
export function deduplicateByUrl<T extends { url: string }>(servers: T[]): T[] {
  const seen = new Set<string>();
  return servers.filter((s) => {
    const norm = normalizeUrl(s.url);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}
