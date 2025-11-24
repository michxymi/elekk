import type { ParsedQuery } from "./query-params";

const DATA_CACHE_PREFIX = "data:";
const OPENAPI_CACHE_KEY = `${DATA_CACHE_PREFIX}openapi`;

/**
 * Cached query result stored in KV
 */
export type CachedQueryResult = {
  /** The query result data */
  data: unknown[];
  /** Timestamp when the data was cached */
  cachedAt: number;
  /** Schema version for cache invalidation */
  version: string;
  /** The parsed query parameters used to generate this result (for SWR revalidation) */
  query?: ParsedQuery;
};

/**
 * Cached OpenAPI specification stored in KV
 */
export type CachedOpenApi = {
  /** The OpenAPI specification object */
  spec: unknown;
  /** Schema version for cache invalidation */
  version: string;
  /** Timestamp when the spec was cached */
  cachedAt: number;
};

/**
 * Safely parses a JSON string, returning null on parse errors
 *
 * @param value - The JSON string to parse
 * @returns Parsed value or null if parsing fails
 */
const parseSafe = <T>(value: string | null): T | null => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.error("Failed to parse cache payload", error);
    return null;
  }
};

/**
 * Generates the cache key for a table's list query (no filters)
 *
 * @param tableName - The database table name
 * @returns Cache key string for the table's list query
 *
 * @example
 * getListCacheKey("users") // "data:users:list"
 */
export const getListCacheKey = (tableName: string) =>
  `${DATA_CACHE_PREFIX}${tableName}:list`;

/**
 * Gets the cache key prefix for all query caches of a table
 *
 * Useful for identifying or invalidating all cached queries for a table.
 *
 * @param tableName - The database table name
 * @returns Cache key prefix for query caches
 *
 * @example
 * getQueryCachePrefix("users") // "data:users:query:"
 */
export const getQueryCachePrefix = (tableName: string) =>
  `${DATA_CACHE_PREFIX}${tableName}:query:`;

/**
 * Reads a cached query result from KV storage
 *
 * @param kv - The KV namespace to read from
 * @param key - The cache key to look up
 * @returns The cached query result or null if not found/invalid
 */
export const readCachedQueryResult = async (
  kv: KVNamespace | undefined,
  key: string
): Promise<CachedQueryResult | null> => {
  if (!kv) {
    return null;
  }

  const raw = await kv.get(key);
  return parseSafe<CachedQueryResult>(raw);
};

/**
 * Writes a query result to KV cache storage
 *
 * @param kv - The KV namespace to write to
 * @param key - The cache key to store under
 * @param payload - The query result data to cache
 */
export const writeCachedQueryResult = async (
  kv: KVNamespace | undefined,
  key: string,
  payload: CachedQueryResult
) => {
  if (!kv) {
    return;
  }

  try {
    await kv.put(key, JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to persist cached query result", error);
  }
};

/**
 * Deletes a cache key from KV storage
 *
 * @param kv - The KV namespace to delete from
 * @param key - The cache key to delete
 */
export const deleteCachedKey = async (
  kv: KVNamespace | undefined,
  key: string
) => {
  if (!kv) {
    return;
  }

  try {
    await kv.delete(key);
  } catch (error) {
    console.error("Failed to delete cache key", error);
  }
};

/**
 * Reads the cached OpenAPI specification from KV storage
 *
 * @param kv - The KV namespace to read from
 * @returns The cached OpenAPI spec or null if not found/invalid
 */
export const readCachedOpenApi = async (
  kv: KVNamespace | undefined
): Promise<CachedOpenApi | null> => {
  if (!kv) {
    return null;
  }

  const raw = await kv.get(OPENAPI_CACHE_KEY);
  return parseSafe<CachedOpenApi>(raw);
};

/**
 * Writes the OpenAPI specification to KV cache storage
 *
 * @param kv - The KV namespace to write to
 * @param payload - The OpenAPI spec data to cache
 */
export const writeCachedOpenApi = async (
  kv: KVNamespace | undefined,
  payload: CachedOpenApi
) => {
  if (!kv) {
    return;
  }

  try {
    await kv.put(OPENAPI_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to persist OpenAPI cache", error);
  }
};
