import type { Context } from "hono";
import { vi } from "vitest";

/**
 * Mock Cloudflare Hyperdrive binding
 */
export function createMockHyperdrive(
  connectionString = "postgresql://test:test@localhost:5432/testdb"
) {
  return {
    connectionString,
  } as unknown as Hyperdrive;
}

/**
 * Mock postgres client
 */
export function createMockPostgresClient() {
  return {
    end: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Mock Drizzle select query builder
 */
export function createMockSelectBuilder(mockResults: unknown[] = []) {
  return {
    from: vi.fn().mockResolvedValue(mockResults),
  };
}

/**
 * Mock Drizzle insert query builder
 */
export function createMockInsertBuilder(mockResult: unknown[] = []) {
  const returningMock = vi.fn().mockResolvedValue(mockResult);
  const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });

  return {
    values: valuesMock,
  };
}

/**
 * Mock Drizzle database instance
 */
export function createMockDrizzleDb(
  options: {
    executeResult?: unknown[];
    selectResult?: unknown[];
    insertResult?: unknown[];
  } = {}
) {
  const { executeResult = [], selectResult = [], insertResult = [] } = options;

  return {
    execute: vi.fn().mockResolvedValue(executeResult),
    select: vi.fn().mockReturnValue(createMockSelectBuilder(selectResult)),
    insert: vi.fn().mockReturnValue(createMockInsertBuilder(insertResult)),
  };
}

/**
 * Mock Hono Request object
 */
export function createMockRequest(
  options: {
    params?: Record<string, string>;
    body?: unknown;
    url?: string;
  } = {}
) {
  const { params = {}, body = {}, url = "http://localhost/test" } = options;

  return {
    param: vi.fn((key?: string) => {
      if (key) {
        return params[key];
      }
      return params;
    }),
    json: vi.fn().mockResolvedValue(body),
    url,
  };
}

/**
 * Mock Hono Context
 */
export function createMockContext<T = unknown>(
  options: {
    env?: Record<string, unknown>;
    params?: Record<string, string>;
    body?: unknown;
    url?: string;
  } = {}
): Context {
  const {
    env = { HYPERDRIVE: createMockHyperdrive() },
    params = {},
    body = {},
    url = "http://localhost/test",
  } = options;

  const jsonMock = vi.fn((data: T, status?: number) => {
    const response = new Response(JSON.stringify(data), {
      status: status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
    return response;
  });

  return {
    env,
    req: createMockRequest({ params, body, url }),
    json: jsonMock,
    // Add other Context methods as needed
  } as unknown as Context;
}

/**
 * Mock postgres module function
 * Use this with vi.mock('postgres') to mock the default export
 */
export function createPostgresMockFactory() {
  return vi.fn(() => createMockPostgresClient());
}

/**
 * Mock drizzle-orm/postgres-js module
 * Use this with vi.mock('drizzle-orm/postgres-js') to mock the drizzle function
 */
export function createDrizzleMockFactory(
  mockDb: ReturnType<typeof createMockDrizzleDb>
) {
  return {
    drizzle: vi.fn(() => mockDb),
  };
}

export function createMockDataCache() {
  const storage = new Map<string, string>();
  const cache = {
    storage,
    get: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
    put: vi.fn((key, value) => {
      const stringValue =
        typeof value === "string" ? value : JSON.stringify(value as never);
      storage.set(key, stringValue);
      return Promise.resolve();
    }),
    delete: vi.fn((key: string) => {
      storage.delete(key);
      return Promise.resolve(true);
    }),
    list: vi.fn(() =>
      Promise.resolve({
        keys: [],
        list_complete: true,
        cacheStatus: null,
      })
    ),
    getWithMetadata: vi.fn(() => Promise.resolve(null)),
  };

  return cache as unknown as KVNamespace & { storage: Map<string, string> };
}
