import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRuntimeSchema } from "@/lib/builder";
import { getListCacheKey } from "@/lib/data-cache";
import { createCrudRouter } from "@/lib/generator";
import {
  SAMPLE_USERS,
  TEST_CONNECTION_STRING,
  TEST_TABLE_NAMES,
  USERS_TABLE_COLUMNS,
} from "../setup/fixtures";
import { createMockDataCache, createMockHyperdrive } from "../setup/mocks";

vi.mock("postgres", () => ({
  __esModule: true,
  default: vi.fn(),
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: vi.fn(),
}));

const mockPostgres = vi.mocked(postgres);
const mockDrizzle = vi.mocked(drizzle);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Query result caching (generator)", () => {
  const { table } = buildRuntimeSchema(
    TEST_TABLE_NAMES.USERS,
    USERS_TABLE_COLUMNS
  );
  const dataCache = createMockDataCache();
  const env = {
    HYPERDRIVE: createMockHyperdrive(TEST_CONNECTION_STRING),
    DATA_CACHE: dataCache,
  };

  it("serves cached list responses without hitting DB", async () => {
    const cacheKey = getListCacheKey(TEST_TABLE_NAMES.USERS);
    dataCache.storage.set(
      cacheKey,
      JSON.stringify({
        data: SAMPLE_USERS,
        cachedAt: Date.now(),
        version: "v1",
      })
    );

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
        schemaVersion: "v1",
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
    expect(dataCache.get).toHaveBeenCalledWith(cacheKey);
  });

  it("invalidates cached list after creating a record", async () => {
    const cacheKey = getListCacheKey(TEST_TABLE_NAMES.USERS);
    dataCache.storage.set(
      cacheKey,
      JSON.stringify({
        data: SAMPLE_USERS,
        cachedAt: Date.now(),
        version: "v1",
      })
    );

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
        schemaVersion: "v1",
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
    expect(dataCache.delete).toHaveBeenCalledWith(cacheKey);
  });
});
