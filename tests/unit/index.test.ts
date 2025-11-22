import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "@/index";
import {
  SAMPLE_USERS,
  TEST_CONNECTION_STRING,
  TEST_TABLE_NAMES,
  USERS_TABLE_COLUMNS,
} from "../setup/fixtures";
import { createMockHyperdrive } from "../setup/mocks";

// Mock all lib modules
vi.mock("@/lib/introspector", () => ({
  getTableVersion: vi.fn(),
  getTableConfig: vi.fn(),
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
import { getTableConfig, getTableVersion } from "@/lib/introspector";

describe("Main Application (index.ts)", () => {
  const mockEnv = {
    HYPERDRIVE: createMockHyperdrive(TEST_CONNECTION_STRING),
  };

  beforeEach(() => {
    vi.clearAllMocks();
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

    it("should rebuild router when version changes (schema drift)", async () => {
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

      // Second request with version v2 (schema changed)
      vi.mocked(getTableVersion).mockResolvedValue("v2");

      const req2 = new Request("http://localhost/api/users/", {
        method: "GET",
      });
      const res2 = await app.fetch(req2, mockEnv as never);

      expect(res2.status).toBe(200);
      // These SHOULD be called because version changed
      expect(getTableConfig).toHaveBeenCalledOnce();
      expect(buildRuntimeSchema).toHaveBeenCalledOnce();
      expect(createCrudRouter).toHaveBeenCalledOnce();
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
        TEST_CONNECTION_STRING
      );
      expect(createCrudRouter).toHaveBeenCalledWith(
        "products",
        {},
        TEST_CONNECTION_STRING
      );
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
    it("should serve OpenAPI spec at /doc", async () => {
      const req = new Request("http://localhost/doc", {
        method: "GET",
      });

      const res = await app.fetch(req, mockEnv as never);

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("openapi");
      expect(body).toHaveProperty("info");
      expect((body.info as Record<string, unknown>).title).toBe("Auto-API");
    });

    it("should serve Swagger UI at /ui", async () => {
      const req = new Request("http://localhost/ui", {
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
        TEST_CONNECTION_STRING
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
});
