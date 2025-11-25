/**
 * Cache API utilities for the Data Plane
 *
 * Uses Cloudflare Cache API for high-volume, short-lived query result caching.
 * Schema version is embedded in cache URLs for automatic invalidation.
 */

const CACHE_NAME = "elekk-data-v1";
const CACHE_URL_PREFIX = "https://cache.elekk.internal/";
const DEFAULT_TTL = 60; // seconds

/**
 * Build a URL-based cache key for Cache API.
 * Embeds schema version for automatic invalidation.
 *
 * @param tableName - The database table name
 * @param queryKey - The query-specific key (e.g., "list" or "query:f[name:eq:John]")
 * @param schemaVersion - Current schema version for cache invalidation
 * @returns Full cache URL
 *
 * @example
 * buildCacheUrl("users", "list", "v1")
 * // => "https://cache.elekk.internal/v1/users/list"
 *
 * buildCacheUrl("users", "query:f[name:eq:John]", "v1")
 * // => "https://cache.elekk.internal/v1/users/query%3Af%5Bname%3Aeq%3AJohn%5D"
 */
export function buildCacheUrl(
  tableName: string,
  queryKey: string,
  schemaVersion: string
): string {
  return `${CACHE_URL_PREFIX}${encodeURIComponent(schemaVersion)}/${tableName}/${encodeURIComponent(queryKey)}`;
}

/**
 * Read from Cache API
 *
 * @param cacheUrl - Full cache URL from buildCacheUrl
 * @returns Cached data or null if not found
 */
export async function readFromCacheApi<T>(cacheUrl: string): Promise<T | null> {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(cacheUrl);

  if (!response) {
    return null;
  }

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Write to Cache API with TTL
 *
 * @param cacheUrl - Full cache URL from buildCacheUrl
 * @param data - Data to cache (will be JSON serialized)
 * @param ttl - Time to live in seconds (default: 60)
 */
export async function writeToCacheApi(
  cacheUrl: string,
  data: unknown,
  ttl: number = DEFAULT_TTL
): Promise<void> {
  const cache = await caches.open(CACHE_NAME);

  const response = new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${ttl}`,
    },
  });

  await cache.put(cacheUrl, response);
}
