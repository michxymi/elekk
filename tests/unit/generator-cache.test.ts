import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRuntimeSchema } from "@/lib/builder";
import { buildCacheUrl } from "@/lib/cache-api";
import { createCrudRouter } from "@/lib/generator";
import {
  SAMPLE_USERS,
  TEST_CONNECTION_STRING,
  TEST_TABLE_NAMES,
  USERS_TABLE_COLUMNS,
} from "../setup/fixtures";
import {
  createMockDataCache,
  createMockHyperdrive,
  mockGlobalCaches,
} from "../setup/mocks";

vi.mock("postgres", () => ({
  __esModule: true,
  default: vi.fn(),
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: vi.fn(),
}));

const mockPostgres = vi.mocked(postgres);
const mockDrizzle = vi.mocked(drizzle);

let mockCaches: ReturnType<typeof mockGlobalCaches>;

beforeEach(() => {
  vi.clearAllMocks();
  mockCaches = mockGlobalCaches();
});

afterEach(() => {
  // @ts-expect-error - cleaning up global mock
  global.caches = undefined;
});

describe("Tiered caching (Cache API + KV)", () => {
  const { table } = buildRuntimeSchema(
    TEST_TABLE_NAMES.USERS,
    USERS_TABLE_COLUMNS
  );
  const dataCache = createMockDataCache();
  const env = {
    HYPERDRIVE: createMockHyperdrive(TEST_CONNECTION_STRING),
    DATA_CACHE: dataCache,
  };

  it("serves cached responses from Cache API without hitting DB", async () => {
    // Set up table version in KV (Control Plane)
    const tableVersion = "v1";
    dataCache.storage.set(`version:${TEST_TABLE_NAMES.USERS}`, tableVersion);

    // Build the cache URL that would be used
    const cacheUrl = buildCacheUrl(
      TEST_TABLE_NAMES.USERS,
      "list",
      tableVersion
    );

    // Pre-populate Cache API (Data Plane)
    const cache = await mockCaches.open("elekk-data-v1");
    await cache.put(cacheUrl, Response.json(SAMPLE_USERS));

    mockDrizzle.mockReturnValue({
      select: () => ({
        from: vi.fn().mockResolvedValue(SAMPLE_USERS),
      }),
      insert: () => ({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      }),
    } as never);
    mockPostgres.mockReturnValue({} as never);

    const router = createCrudRouter(
      TEST_TABLE_NAMES.USERS,
      table,
      TEST_CONNECTION_STRING,
      {
        env,
        schemaVersion: tableVersion,
        columns: USERS_TABLE_COLUMNS,
      }
    );
    const response = await router.fetch(
      new Request("http://localhost/", {
        method: "GET",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SAMPLE_USERS);

    // Verify Cache API was checked
    expect(cache.match).toHaveBeenCalledWith(cacheUrl);
  });

  it("invalidates cache by bumping table version on POST", async () => {
    // Set initial version
    const initialVersion = "v1";
    dataCache.storage.set(`version:${TEST_TABLE_NAMES.USERS}`, initialVersion);

    const insertResult = [{ id: 2, name: "New" }];
    mockDrizzle.mockReturnValue({
      select: () => ({
        from: vi.fn().mockResolvedValue(insertResult),
      }),
      insert: () => ({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(insertResult),
        }),
      }),
    } as never);
    mockPostgres.mockReturnValue({} as never);

    const router = createCrudRouter(
      TEST_TABLE_NAMES.USERS,
      table,
      TEST_CONNECTION_STRING,
      {
        env,
        schemaVersion: initialVersion,
        columns: USERS_TABLE_COLUMNS,
      }
    );
    const response = await router.fetch(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New" }),
      })
    );

    expect(response.status).toBe(201);

    // Verify version was bumped in KV (not deleted)
    expect(dataCache.put).toHaveBeenCalledWith(
      `version:${TEST_TABLE_NAMES.USERS}`,
      expect.any(String)
    );

    // The new version should be a timestamp (different from initial)
    const newVersion = dataCache.storage.get(
      `version:${TEST_TABLE_NAMES.USERS}`
    );
    expect(newVersion).not.toBe(initialVersion);
    expect(Number(newVersion)).toBeGreaterThan(0);
  });

  it("fetches from database on cache miss and returns results", async () => {
    // Set up version but no cache entry (cache miss scenario)
    const tableVersion = "v1";
    dataCache.storage.set(`version:${TEST_TABLE_NAMES.USERS}`, tableVersion);

    mockDrizzle.mockReturnValue({
      select: () => ({
        from: vi.fn().mockResolvedValue(SAMPLE_USERS),
      }),
      insert: () => ({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      }),
    } as never);
    mockPostgres.mockReturnValue({} as never);

    const router = createCrudRouter(
      TEST_TABLE_NAMES.USERS,
      table,
      TEST_CONNECTION_STRING,
      {
        env,
        schemaVersion: tableVersion,
        columns: USERS_TABLE_COLUMNS,
      }
    );

    const request = new Request("http://localhost/", { method: "GET" });
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SAMPLE_USERS);

    // Verify Cache API was checked (miss)
    const cache = await mockCaches.open("elekk-data-v1");
    const cacheUrl = buildCacheUrl(
      TEST_TABLE_NAMES.USERS,
      "list",
      tableVersion
    );
    expect(cache.match).toHaveBeenCalledWith(cacheUrl);
  });

  it("initializes table version in KV when not set", async () => {
    // Clear storage and don't set version in KV
    dataCache.storage.clear();
    const schemaVersion = "initial-v1";

    mockDrizzle.mockReturnValue({
      select: () => ({
        from: vi.fn().mockResolvedValue(SAMPLE_USERS),
      }),
      insert: () => ({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      }),
    } as never);
    mockPostgres.mockReturnValue({} as never);

    const router = createCrudRouter(
      TEST_TABLE_NAMES.USERS,
      table,
      TEST_CONNECTION_STRING,
      {
        env,
        schemaVersion,
        columns: USERS_TABLE_COLUMNS,
      }
    );
    await router.fetch(new Request("http://localhost/", { method: "GET" }));

    // Verify version was initialized in KV
    expect(dataCache.put).toHaveBeenCalledWith(
      `version:${TEST_TABLE_NAMES.USERS}`,
      schemaVersion
    );
  });
});
