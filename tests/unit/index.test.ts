import { beforeEach, describe, expect, it, vi } from "vitest";
import app, {
  getSchemaCacheKey,
  HOT_CACHE,
  validateSchemaCache,
} from "@/index";
import {
  SAMPLE_USERS,
  TEST_CONNECTION_STRING,
  TEST_TABLE_NAMES,
  USERS_TABLE_COLUMNS,
} from "../setup/fixtures";
import { createMockDataCache, createMockHyperdrive } from "../setup/mocks";

// Mock all lib modules
vi.mock("@/lib/introspector", () => ({
  getTableVersion: vi.fn(),
  getTableConfig: vi.fn(),
  getSchemaVersion: vi.fn(),
  getEntireSchemaConfig: vi.fn(),
}));

vi.mock("@/lib/builder", () => ({
  buildRuntimeSchema: vi.fn(),
}));

vi.mock("@/lib/generator", () => ({
  createCrudRouter: vi.fn(),
}));

// Import mocked modules
import { buildRuntimeSchema } from "@/lib/builder";
import { createCrudRouter } from "@/lib/generator";
import {
  getEntireSchemaConfig,
  getSchemaVersion,
  getTableConfig,
  getTableVersion,
} from "@/lib/introspector";

describe("Main Application (index.ts)", () => {
  let dataCache: ReturnType<typeof createMockDataCache>;
  let mockEnv: {
    HYPERDRIVE: ReturnType<typeof createMockHyperdrive>;
    DATA_CACHE: ReturnType<typeof createMockDataCache>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dataCache = createMockDataCache();
    mockEnv = {
      HYPERDRIVE: createMockHyperdrive(TEST_CONNECTION_STRING),
      DATA_CACHE: dataCache,
    };
    for (const key of Object.keys(HOT_CACHE)) {
      delete HOT_CACHE[key];
    }
  });

  describe("Cache Mechanism", () => {
    it("should build router on first request (cache miss)", async () => {
      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(SAMPLE_USERS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req = new Request("http://localhost/api/users/", {
        method: "GET",
      });

      const res = await app.fetch(req, mockEnv as never);

      expect(res.status).toBe(200);
      expect(getTableVersion).toHaveBeenCalledWith(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.USERS
      );
      expect(getTableConfig).toHaveBeenCalledWith(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.USERS
      );
      expect(buildRuntimeSchema).toHaveBeenCalledWith(
        TEST_TABLE_NAMES.USERS,
        USERS_TABLE_COLUMNS
      );
      expect(createCrudRouter).toHaveBeenCalledOnce();
    });

    it("should reuse cached router on second request with same version (cache hit)", async () => {
      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(SAMPLE_USERS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      // Use unique table name to avoid cache conflicts from other tests
      const uniqueTable = "cache_test_users";

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      // First request - builds router
      const req1 = new Request(`http://localhost/api/${uniqueTable}/`, {
        method: "GET",
      });
      await app.fetch(req1, mockEnv as never);

      // Verify router was called on first request
      expect(mockRouter.fetch).toHaveBeenCalledTimes(1);

      // Clear mock call counts but keep the mocked implementation
      vi.mocked(getTableConfig).mockClear();
      vi.mocked(buildRuntimeSchema).mockClear();
      vi.mocked(createCrudRouter).mockClear();
      mockRouter.fetch.mockClear();

      // Second request - should use cache
      const req2 = new Request(`http://localhost/api/${uniqueTable}/`, {
        method: "GET",
      });
      const res2 = await app.fetch(req2, mockEnv as never);

      expect(res2.status).toBe(200);
      expect(getTableVersion).toHaveBeenCalledWith(
        TEST_CONNECTION_STRING,
        uniqueTable
      );
      // These should NOT be called on cache hit
      expect(getTableConfig).not.toHaveBeenCalled();
      expect(buildRuntimeSchema).not.toHaveBeenCalled();
      expect(createCrudRouter).not.toHaveBeenCalled();
      // Router should still be used
      expect(mockRouter.fetch).toHaveBeenCalledTimes(1);
    });

    it("should serve stale router immediately when HOT_CACHE hit (SWR behavior)", async () => {
      // With SWR, we serve cached data immediately and validate in background.
      // The rebuild happens on the NEXT request after cache invalidation.
      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(SAMPLE_USERS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      // First request with version v1
      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req1 = new Request("http://localhost/api/users/", {
        method: "GET",
      });
      await app.fetch(req1, mockEnv as never);

      // Clear mocks
      vi.mocked(getTableConfig).mockClear();
      vi.mocked(buildRuntimeSchema).mockClear();
      vi.mocked(createCrudRouter).mockClear();
      vi.mocked(getTableVersion).mockClear();

      // Second request - HOT_CACHE should serve immediately without DB call
      // (background validation would invalidate if version changed)
      const req2 = new Request("http://localhost/api/users/", {
        method: "GET",
      });
      const res2 = await app.fetch(req2, mockEnv as never);

      expect(res2.status).toBe(200);
      // With SWR, these should NOT be called - we serve from cache immediately
      expect(getTableVersion).not.toHaveBeenCalled();
      expect(getTableConfig).not.toHaveBeenCalled();
      expect(buildRuntimeSchema).not.toHaveBeenCalled();
      expect(createCrudRouter).not.toHaveBeenCalled();
      // Router should be reused
      expect(mockRouter.fetch).toHaveBeenCalledTimes(2);
    });

    it("should cache routers for different tables independently", async () => {
      const mockUsersRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      const mockProductsRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      // Setup mocks for users table
      vi.mocked(getTableVersion).mockImplementation((_, tableName) => {
        if (tableName === "users") {
          return Promise.resolve("v1");
        }
        if (tableName === "products") {
          return Promise.resolve("v1");
        }
        return Promise.resolve(null);
      });

      vi.mocked(getTableConfig).mockImplementation((_, tableName) => {
        if (tableName === "users") {
          return Promise.resolve(USERS_TABLE_COLUMNS);
        }
        if (tableName === "products") {
          return Promise.resolve([
            { name: "id", type: "integer", nullable: false },
            { name: "name", type: "text", nullable: false },
          ]);
        }
        return Promise.resolve(null);
      });

      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });

      vi.mocked(createCrudRouter).mockImplementation((tableName) => {
        if (tableName === "users") {
          return mockUsersRouter as never;
        }
        if (tableName === "products") {
          return mockProductsRouter as never;
        }
        return {} as never;
      });

      // Request to users
      const reqUsers = new Request("http://localhost/api/users/", {
        method: "GET",
      });
      await app.fetch(reqUsers, mockEnv as never);

      // Request to products
      const reqProducts = new Request("http://localhost/api/products/", {
        method: "GET",
      });
      await app.fetch(reqProducts, mockEnv as never);

      expect(createCrudRouter).toHaveBeenCalledTimes(2);
      expect(createCrudRouter).toHaveBeenCalledWith(
        "users",
        {},
        TEST_CONNECTION_STRING,
        { env: mockEnv, schemaVersion: "v1", columns: USERS_TABLE_COLUMNS }
      );
      expect(createCrudRouter).toHaveBeenCalledWith(
        "products",
        {},
        TEST_CONNECTION_STRING,
        {
          env: mockEnv,
          schemaVersion: "v1",
          columns: [
            { name: "id", type: "integer", nullable: false },
            { name: "name", type: "text", nullable: false },
          ],
        }
      );
    });

    it("should bypass cache when X-Cache-Control: no-cache header is present", async () => {
      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(SAMPLE_USERS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      const uniqueTable = "no_cache_test_users";

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      // First request - builds router and caches it
      const req1 = new Request(`http://localhost/api/${uniqueTable}/`, {
        method: "GET",
      });
      await app.fetch(req1, mockEnv as never);

      // Clear mock call counts
      vi.mocked(getTableConfig).mockClear();
      vi.mocked(buildRuntimeSchema).mockClear();
      vi.mocked(createCrudRouter).mockClear();

      // Second request WITH X-Cache-Control: no-cache header - should bypass cache
      const req2 = new Request(`http://localhost/api/${uniqueTable}/`, {
        method: "GET",
        headers: { "X-Cache-Control": "no-cache" },
      });
      const res2 = await app.fetch(req2, mockEnv as never);

      expect(res2.status).toBe(200);
      // These SHOULD be called even though router is cached
      expect(getTableConfig).toHaveBeenCalledOnce();
      expect(buildRuntimeSchema).toHaveBeenCalledOnce();
      expect(createCrudRouter).toHaveBeenCalledOnce();
    });

    it("should use cache when X-Cache-Control header is absent", async () => {
      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(SAMPLE_USERS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      const uniqueTable = "normal_cache_test_users";

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      // First request - builds router
      const req1 = new Request(`http://localhost/api/${uniqueTable}/`, {
        method: "GET",
      });
      await app.fetch(req1, mockEnv as never);

      // Clear mock call counts
      vi.mocked(getTableConfig).mockClear();
      vi.mocked(buildRuntimeSchema).mockClear();
      vi.mocked(createCrudRouter).mockClear();

      // Second request WITHOUT header - should use cache
      const req2 = new Request(`http://localhost/api/${uniqueTable}/`, {
        method: "GET",
      });
      const res2 = await app.fetch(req2, mockEnv as never);

      expect(res2.status).toBe(200);
      // These should NOT be called on cache hit
      expect(getTableConfig).not.toHaveBeenCalled();
      expect(buildRuntimeSchema).not.toHaveBeenCalled();
      expect(createCrudRouter).not.toHaveBeenCalled();
    });

    it("should use cache when X-Cache-Control has other values", async () => {
      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(SAMPLE_USERS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      const uniqueTable = "other_cache_control_users";

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      // First request - builds router
      const req1 = new Request(`http://localhost/api/${uniqueTable}/`, {
        method: "GET",
      });
      await app.fetch(req1, mockEnv as never);

      // Clear mock call counts
      vi.mocked(getTableConfig).mockClear();
      vi.mocked(buildRuntimeSchema).mockClear();
      vi.mocked(createCrudRouter).mockClear();

      // Second request with different Cache-Control value - should use cache
      const req2 = new Request(`http://localhost/api/${uniqueTable}/`, {
        method: "GET",
        headers: { "X-Cache-Control": "max-age=3600" },
      });
      const res2 = await app.fetch(req2, mockEnv as never);

      expect(res2.status).toBe(200);
      // These should NOT be called because only "no-cache" bypasses cache
      expect(getTableConfig).not.toHaveBeenCalled();
      expect(buildRuntimeSchema).not.toHaveBeenCalled();
      expect(createCrudRouter).not.toHaveBeenCalled();
    });

    it("should persist schema metadata to KV on cache miss", async () => {
      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(SAMPLE_USERS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req = new Request("http://localhost/api/users/", {
        method: "GET",
      });
      await app.fetch(req, mockEnv as never);

      const key = getSchemaCacheKey(TEST_TABLE_NAMES.USERS);
      const putMock = vi.mocked(dataCache.put);
      expect(putMock).toHaveBeenCalledWith(key, expect.any(String));

      const storedValue = putMock.mock.calls[0]?.[1];
      const payload = JSON.parse(
        typeof storedValue === "string" ? storedValue : "{}"
      );
      expect(payload.version).toBe("v1");
      expect(payload.columns).toEqual(USERS_TABLE_COLUMNS);
    });

    it("should rebuild router from KV when HOT cache is empty", async () => {
      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(SAMPLE_USERS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req = new Request("http://localhost/api/users/", {
        method: "GET",
      });
      await app.fetch(req, mockEnv as never);

      delete HOT_CACHE[TEST_TABLE_NAMES.USERS];

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockClear();

      const secondReq = new Request("http://localhost/api/users/", {
        method: "GET",
      });
      const res = await app.fetch(secondReq, mockEnv as never);

      expect(res.status).toBe(200);
      expect(vi.mocked(dataCache.get)).toHaveBeenCalledWith(
        getSchemaCacheKey(TEST_TABLE_NAMES.USERS)
      );
      expect(getTableConfig).not.toHaveBeenCalled();
    });

    it("should invalidate caches when schema validation detects drift", async () => {
      const tableName = TEST_TABLE_NAMES.USERS;
      HOT_CACHE[tableName] = {
        router: {} as never,
        version: "v1",
      };
      const key = getSchemaCacheKey(tableName);
      dataCache.storage.set(
        key,
        JSON.stringify({
          version: "v1",
          columns: USERS_TABLE_COLUMNS,
        })
      );

      vi.mocked(getTableVersion).mockResolvedValue("v2");

      await validateSchemaCache(
        mockEnv as never,
        TEST_CONNECTION_STRING,
        tableName,
        "v1"
      );

      expect(vi.mocked(dataCache.delete)).toHaveBeenCalledWith(key);
      expect(HOT_CACHE[tableName]).toBeUndefined();
    });

    it("should retain caches when schema validation finds no change", async () => {
      const tableName = TEST_TABLE_NAMES.USERS;
      HOT_CACHE[tableName] = {
        router: {} as never,
        version: "v1",
      };
      const key = getSchemaCacheKey(tableName);
      dataCache.storage.set(
        key,
        JSON.stringify({
          version: "v1",
          columns: USERS_TABLE_COLUMNS,
        })
      );

      vi.mocked(getTableVersion).mockResolvedValue("v1");

      await validateSchemaCache(
        mockEnv as never,
        TEST_CONNECTION_STRING,
        tableName,
        "v1"
      );

      expect(vi.mocked(dataCache.delete)).not.toHaveBeenCalled();
      expect(HOT_CACHE[tableName]).toEqual({
        router: {} as never,
        version: "v1",
      });
    });
  });

  describe("URL Routing and Request Forwarding", () => {
    it("should extract table name from URL parameter", async () => {
      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req = new Request("http://localhost/api/users/", {
        method: "GET",
      });
      await app.fetch(req, mockEnv as never);

      expect(getTableVersion).toHaveBeenCalledWith(
        TEST_CONNECTION_STRING,
        "users"
      );
    });

    it("should strip table prefix from URL before forwarding to router", async () => {
      // Use unique table name to avoid cache conflicts
      const uniqueTable = "strip_test_table";

      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req = new Request(`http://localhost/api/${uniqueTable}/`, {
        method: "GET",
      });
      await app.fetch(req, mockEnv as never);

      expect(mockRouter.fetch).toHaveBeenCalledOnce();
      const forwardedRequest = mockRouter.fetch.mock.calls[0]?.[0];
      expect(forwardedRequest?.url).toBe("http://localhost/");
    });

    it("should forward POST requests correctly", async () => {
      // Use unique table name to avoid cache conflicts
      const uniqueTable = "post_test_table";

      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ id: 1 }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req = new Request(`http://localhost/api/${uniqueTable}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test" }),
      });

      const res = await app.fetch(req, mockEnv as never);

      expect(res.status).toBe(201);
      expect(mockRouter.fetch).toHaveBeenCalledOnce();
      const forwardedRequest = mockRouter.fetch.mock.calls[0]?.[0];
      expect(forwardedRequest?.method).toBe("POST");
    });

    it("should handle different table names in URLs", async () => {
      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue([
        { name: "id", type: "integer", nullable: false },
      ]);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const tableNames = ["users", "products", "posts", "orders"];

      for (const tableName of tableNames) {
        const req = new Request(`http://localhost/api/${tableName}/`, {
          method: "GET",
        });
        await app.fetch(req, mockEnv as never);
      }

      expect(getTableVersion).toHaveBeenCalledTimes(tableNames.length);
      for (const tableName of tableNames) {
        expect(getTableVersion).toHaveBeenCalledWith(
          TEST_CONNECTION_STRING,
          tableName
        );
      }
    });
  });

  describe("Error Handling", () => {
    it("should return 404 when table does not exist (getTableVersion returns null)", async () => {
      vi.mocked(getTableVersion).mockResolvedValue(null);

      const req = new Request(
        `http://localhost/api/${TEST_TABLE_NAMES.NONEXISTENT}/`,
        { method: "GET" }
      );

      const res = await app.fetch(req, mockEnv as never);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: "Table not found" });

      // Should not proceed to build router
      expect(getTableConfig).not.toHaveBeenCalled();
      expect(buildRuntimeSchema).not.toHaveBeenCalled();
      expect(createCrudRouter).not.toHaveBeenCalled();
    });

    it("should return 404 when getTableConfig returns null", async () => {
      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(null);

      const req = new Request(
        `http://localhost/api/${TEST_TABLE_NAMES.NONEXISTENT}/`,
        { method: "GET" }
      );

      const res = await app.fetch(req, mockEnv as never);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: "Table not found" });

      // Should not proceed to build router
      expect(buildRuntimeSchema).not.toHaveBeenCalled();
      expect(createCrudRouter).not.toHaveBeenCalled();
    });

    it("should handle errors during introspection gracefully", async () => {
      vi.mocked(getTableVersion).mockRejectedValue(
        new Error("Database connection failed")
      );

      const req = new Request("http://localhost/api/users/", {
        method: "GET",
      });

      // Hono catches errors and returns 500 response instead of throwing
      const res = await app.fetch(req, mockEnv as never);
      expect(res.status).toBe(500);
    });
  });

  describe("OpenAPI Documentation Endpoints", () => {
    it("should serve OpenAPI spec at /openapi.json", async () => {
      vi.mocked(getSchemaVersion).mockResolvedValue("schema-v1");
      vi.mocked(getEntireSchemaConfig).mockResolvedValue({
        users: USERS_TABLE_COLUMNS,
      });
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      const mockRouter = {
        routes: [],
        fetch: vi.fn(),
      };
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req = new Request("http://localhost/openapi.json", {
        method: "GET",
      });

      const res = await app.fetch(req, mockEnv as never);

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("openapi");
      expect(body).toHaveProperty("info");
      expect((body.info as Record<string, unknown>).title).toBe(
        "Elekk Auto-API"
      );
    });

    it("should serve Swagger UI at /docs", async () => {
      const req = new Request("http://localhost/docs", {
        method: "GET",
      });

      const res = await app.fetch(req, mockEnv as never);

      expect(res.status).toBe(200);
      // Swagger UI returns HTML
      const contentType = res.headers.get("content-type");
      expect(contentType).toContain("text/html");
    });
  });

  describe("Hyperdrive Integration", () => {
    it("should use Hyperdrive connection string from environment", async () => {
      // Use unique table name to avoid cache conflicts
      const uniqueTable = "hyperdrive_test_table";

      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req = new Request(`http://localhost/api/${uniqueTable}/`, {
        method: "GET",
      });
      await app.fetch(req, mockEnv as never);

      expect(getTableVersion).toHaveBeenCalledWith(
        TEST_CONNECTION_STRING,
        uniqueTable
      );
      expect(getTableConfig).toHaveBeenCalledWith(
        TEST_CONNECTION_STRING,
        uniqueTable
      );
      expect(createCrudRouter).toHaveBeenCalledWith(
        uniqueTable,
        {},
        TEST_CONNECTION_STRING,
        { env: mockEnv, schemaVersion: "v1", columns: USERS_TABLE_COLUMNS }
      );
    });

    it("should work with different Hyperdrive connection strings", async () => {
      const alternativeConnectionString =
        "postgresql://alt:alt@localhost:5432/altdb";
      const altEnv = {
        HYPERDRIVE: createMockHyperdrive(alternativeConnectionString),
      };

      const mockRouter = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      };

      vi.mocked(getTableVersion).mockResolvedValue("v1");
      vi.mocked(getTableConfig).mockResolvedValue(USERS_TABLE_COLUMNS);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req = new Request("http://localhost/api/users/", {
        method: "GET",
      });
      await app.fetch(req, altEnv as never);

      expect(getTableVersion).toHaveBeenCalledWith(
        alternativeConnectionString,
        "users"
      );
    });
  });

  describe("OpenAPI Spec Generation", () => {
    it("should call appropriate functions when generating OpenAPI spec", async () => {
      const mockSchemaConfig = {
        users: USERS_TABLE_COLUMNS,
        posts: [
          { name: "id", type: "integer", nullable: false },
          { name: "title", type: "text", nullable: false },
        ],
      };

      // Use unique version to avoid cache collision with other tests
      vi.mocked(getSchemaVersion).mockResolvedValue("unique-function-test-v1");
      vi.mocked(getEntireSchemaConfig).mockResolvedValue(mockSchemaConfig);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      // Mock router that has the necessary Hono structure
      const mockRouter = {
        routes: [],
        fetch: vi.fn(),
      };
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req = new Request("http://localhost/openapi.json", {
        method: "GET",
      });

      const res = await app.fetch(req, mockEnv as never);

      expect(res.status).toBe(200);

      // Verify functions were called with correct arguments
      expect(getSchemaVersion).toHaveBeenCalledWith(TEST_CONNECTION_STRING);
      // Check that the function was called at least once (may be called by previous tests too)
      expect(getSchemaVersion).toHaveBeenCalled();
      expect(getEntireSchemaConfig).toHaveBeenCalled();
      expect(buildRuntimeSchema).toHaveBeenCalled();
      expect(createCrudRouter).toHaveBeenCalled();
    });

    it("should cache OpenAPI spec on subsequent requests with same version", async () => {
      const mockSchemaConfig = {
        users: USERS_TABLE_COLUMNS,
      };

      // Set up mocks to return consistent version
      vi.mocked(getSchemaVersion).mockResolvedValue("cache-test-v1");
      vi.mocked(getEntireSchemaConfig).mockResolvedValue(mockSchemaConfig);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      const mockRouter = {
        routes: [],
        fetch: vi.fn(),
      };
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      // First request - should introspect
      const req1 = new Request("http://localhost/openapi.json", {
        method: "GET",
      });
      const res1 = await app.fetch(req1, mockEnv as never);
      expect(res1.status).toBe(200);

      const callCountAfterFirst = vi.mocked(getEntireSchemaConfig).mock.calls
        .length;
      expect(callCountAfterFirst).toBeGreaterThan(0);

      // Second request with same version - should use cache
      const req2 = new Request("http://localhost/openapi.json", {
        method: "GET",
      });
      const res2 = await app.fetch(req2, mockEnv as never);
      expect(res2.status).toBe(200);

      // getSchemaVersion called again, but getEntireSchemaConfig should not be
      const callCountAfterSecond = vi.mocked(getEntireSchemaConfig).mock.calls
        .length;
      expect(callCountAfterSecond).toBe(callCountAfterFirst); // No additional calls
    });

    it("should invalidate cache when schema version changes", async () => {
      const mockSchemaConfig = {
        users: USERS_TABLE_COLUMNS,
      };

      // First request with version 1
      vi.mocked(getSchemaVersion).mockResolvedValueOnce("invalidate-test-v1");
      vi.mocked(getEntireSchemaConfig).mockResolvedValue(mockSchemaConfig);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      const mockRouter = {
        routes: [],
        fetch: vi.fn(),
      };
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req1 = new Request("http://localhost/openapi.json", {
        method: "GET",
      });
      const res1 = await app.fetch(req1, mockEnv as never);
      expect(res1.status).toBe(200);

      const callCountAfterFirst = vi.mocked(getEntireSchemaConfig).mock.calls
        .length;

      // Second request with version 2 - should re-introspect
      vi.mocked(getSchemaVersion).mockResolvedValueOnce("invalidate-test-v2");

      const req2 = new Request("http://localhost/openapi.json", {
        method: "GET",
      });
      const res2 = await app.fetch(req2, mockEnv as never);
      expect(res2.status).toBe(200);

      // Should have called getEntireSchemaConfig again due to version change
      const callCountAfterSecond = vi.mocked(getEntireSchemaConfig).mock.calls
        .length;
      expect(callCountAfterSecond).toBeGreaterThan(callCountAfterFirst);
    });

    it("should handle schema version retrieval failure", async () => {
      vi.mocked(getSchemaVersion).mockResolvedValue(null);

      const req = new Request("http://localhost/openapi.json", {
        method: "GET",
      });

      const res = await app.fetch(req, mockEnv as never);

      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("error");
    });

    it("should generate spec with correct metadata", async () => {
      const mockSchemaConfig = {
        users: USERS_TABLE_COLUMNS,
      };

      vi.mocked(getSchemaVersion).mockResolvedValue("schema-v1");
      vi.mocked(getEntireSchemaConfig).mockResolvedValue(mockSchemaConfig);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      const mockRouter = {
        routes: [],
        fetch: vi.fn(),
      };
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      const req = new Request("http://localhost/openapi.json", {
        method: "GET",
      });

      const res = await app.fetch(req, mockEnv as never);

      expect(res.status).toBe(200);
      const spec = (await res.json()) as Record<string, unknown>;

      // Verify metadata
      expect(spec.openapi).toBe("3.0.0");
      const info = spec.info as Record<string, unknown>;
      expect(info.title).toBe("Elekk Auto-API");
      expect(info.version).toBe("1.0.0");
      expect(info.description).toContain("Auto-generated REST API");

      // Verify servers
      const servers = spec.servers as Record<string, unknown>[];
      expect(servers).toHaveLength(1);
      const server = servers[0];
      expect(server).toBeDefined();
      expect(server?.url).toBe("http://localhost");
    });

    it("should bypass OpenAPI cache when X-Cache-Control: no-cache header is present", async () => {
      const mockSchemaConfig = {
        users: USERS_TABLE_COLUMNS,
      };

      vi.mocked(getSchemaVersion).mockResolvedValue("openapi-no-cache-test-v1");
      vi.mocked(getEntireSchemaConfig).mockResolvedValue(mockSchemaConfig);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      const mockRouter = {
        routes: [],
        fetch: vi.fn(),
      };
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      // First request - builds and caches spec
      const req1 = new Request("http://localhost/openapi.json", {
        method: "GET",
      });
      const res1 = await app.fetch(req1, mockEnv as never);
      expect(res1.status).toBe(200);

      const callCountAfterFirst = vi.mocked(getEntireSchemaConfig).mock.calls
        .length;

      // Second request WITH X-Cache-Control: no-cache - should bypass cache
      const req2 = new Request("http://localhost/openapi.json", {
        method: "GET",
        headers: { "X-Cache-Control": "no-cache" },
      });
      const res2 = await app.fetch(req2, mockEnv as never);
      expect(res2.status).toBe(200);

      // getEntireSchemaConfig SHOULD be called again even though spec is cached
      const callCountAfterSecond = vi.mocked(getEntireSchemaConfig).mock.calls
        .length;
      expect(callCountAfterSecond).toBeGreaterThan(callCountAfterFirst);
    });

    it("should use cached OpenAPI spec when X-Cache-Control header is absent", async () => {
      const mockSchemaConfig = {
        users: USERS_TABLE_COLUMNS,
      };

      vi.mocked(getSchemaVersion).mockResolvedValue(
        "openapi-normal-cache-test-v1"
      );
      vi.mocked(getEntireSchemaConfig).mockResolvedValue(mockSchemaConfig);
      vi.mocked(buildRuntimeSchema).mockReturnValue({
        table: {},
        zodSchema: {} as never,
      });
      const mockRouter = {
        routes: [],
        fetch: vi.fn(),
      };
      vi.mocked(createCrudRouter).mockReturnValue(mockRouter as never);

      // First request - builds spec
      const req1 = new Request("http://localhost/openapi.json", {
        method: "GET",
      });
      const res1 = await app.fetch(req1, mockEnv as never);
      expect(res1.status).toBe(200);

      const callCountAfterFirst = vi.mocked(getEntireSchemaConfig).mock.calls
        .length;

      // Second request WITHOUT header - should use cache
      const req2 = new Request("http://localhost/openapi.json", {
        method: "GET",
      });
      const res2 = await app.fetch(req2, mockEnv as never);
      expect(res2.status).toBe(200);

      // getEntireSchemaConfig should NOT be called again
      const callCountAfterSecond = vi.mocked(getEntireSchemaConfig).mock.calls
        .length;
      expect(callCountAfterSecond).toBe(callCountAfterFirst);
    });
  });
});
