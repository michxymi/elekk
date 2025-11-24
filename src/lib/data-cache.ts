const DATA_CACHE_PREFIX = "data:";
const OPENAPI_CACHE_KEY = `${DATA_CACHE_PREFIX}openapi`;

export type CachedQueryResult = {
  data: unknown[];
  cachedAt: number;
  version: string;
};

export type CachedOpenApi = {
  spec: unknown;
  version: string;
  cachedAt: number;
};

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

export const getListCacheKey = (tableName: string) =>
  `${DATA_CACHE_PREFIX}${tableName}:list`;

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

export const readCachedOpenApi = async (
  kv: KVNamespace | undefined
): Promise<CachedOpenApi | null> => {
  if (!kv) {
    return null;
  }

  const raw = await kv.get(OPENAPI_CACHE_KEY);
  return parseSafe<CachedOpenApi>(raw);
};

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
