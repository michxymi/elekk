import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRuntimeSchema } from "@/lib/builder";
import { createCrudRouter } from "@/lib/generator";
import {
  SAMPLE_USER,
  SAMPLE_USERS,
  TEST_CONNECTION_STRING,
  TEST_TABLE_NAMES,
  USERS_TABLE_COLUMNS,
} from "../setup/fixtures";
import { createMockDrizzleDb, createMockPostgresClient } from "../setup/mocks";

// Mock postgres module
vi.mock("postgres", () => ({
  default: vi.fn(),
}));

// Mock drizzle-orm/postgres-js
vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: vi.fn(),
}));

import { drizzle } from "drizzle-orm/postgres-js";
// Import mocked modules
import postgres from "postgres";

describe("createCrudRouter", () => {
  let mockClient: ReturnType<typeof createMockPostgresClient>;
  let mockDb: ReturnType<typeof createMockDrizzleDb>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = createMockPostgresClient();

    // Setup default mocks
    vi.mocked(postgres).mockReturnValue(mockClient as never);
  });

  describe("Router Creation", () => {
    it("should create an OpenAPIHono router", () => {
      mockDb = createMockDrizzleDb();
      vi.mocked(drizzle).mockReturnValue(mockDb as never);

      const schema = buildRuntimeSchema(
        TEST_TABLE_NAMES.USERS,
        USERS_TABLE_COLUMNS
      );
      const router = createCrudRouter(
        TEST_TABLE_NAMES.USERS,
        schema.table,
        TEST_CONNECTION_STRING
      );

      expect(router).toBeDefined();
      expect(typeof router.fetch).toBe("function");
    });

    it("should create router with table name", () => {
      mockDb = createMockDrizzleDb();
      vi.mocked(drizzle).mockReturnValue(mockDb as never);

      const schema = buildRuntimeSchema(
        TEST_TABLE_NAMES.PRODUCTS,
        USERS_TABLE_COLUMNS
      );
      const router = createCrudRouter(
        TEST_TABLE_NAMES.PRODUCTS,
        schema.table,
        TEST_CONNECTION_STRING
      );

      expect(router).toBeDefined();
    });
  });

  describe("GET / (List All)", () => {
    it("should return all records with 200 status", async () => {
      mockDb = createMockDrizzleDb({ selectResult: SAMPLE_USERS });
      vi.mocked(drizzle).mockReturnValue(mockDb as never);

      const schema = buildRuntimeSchema(
        TEST_TABLE_NAMES.USERS,
        USERS_TABLE_COLUMNS
      );
      const router = createCrudRouter(
        TEST_TABLE_NAMES.USERS,
        schema.table,
        TEST_CONNECTION_STRING
      );

      const req = new Request("http://localhost/");
      const res = await router.fetch(req);

      expect(res.status).toBe(200);
      expect(postgres).toHaveBeenCalledWith(TEST_CONNECTION_STRING);
      expect(drizzle).toHaveBeenCalledWith(mockClient);
      expect(mockDb.select).toHaveBeenCalledOnce();
      expect(mockClient.end).toHaveBeenCalledOnce();

      const body = await res.json();
      expect(body).toEqual(SAMPLE_USERS);
    });

    it("should return empty array when no records exist", async () => {
      mockDb = createMockDrizzleDb({ selectResult: [] });
      vi.mocked(drizzle).mockReturnValue(mockDb as never);

      const schema = buildRuntimeSchema(
        TEST_TABLE_NAMES.USERS,
        USERS_TABLE_COLUMNS
      );
      const router = createCrudRouter(
        TEST_TABLE_NAMES.USERS,
        schema.table,
        TEST_CONNECTION_STRING
      );

      const req = new Request("http://localhost/");
      const res = await router.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it("should close database connection after successful query", async () => {
      mockDb = createMockDrizzleDb({ selectResult: SAMPLE_USERS });
      vi.mocked(drizzle).mockReturnValue(mockDb as never);

      const schema = buildRuntimeSchema(
        TEST_TABLE_NAMES.USERS,
        USERS_TABLE_COLUMNS
      );
      const router = createCrudRouter(
        TEST_TABLE_NAMES.USERS,
        schema.table,
        TEST_CONNECTION_STRING
      );

      const req = new Request("http://localhost/");
      await router.fetch(req);

      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should close database connection after failed query", async () => {
      mockDb = createMockDrizzleDb();
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockRejectedValue(new Error("Database error")),
      });
      vi.mocked(drizzle).mockReturnValue(mockDb as never);

      const schema = buildRuntimeSchema(
        TEST_TABLE_NAMES.USERS,
        USERS_TABLE_COLUMNS
      );
      const router = createCrudRouter(
        TEST_TABLE_NAMES.USERS,
        schema.table,
        TEST_CONNECTION_STRING
      );

      const req = new Request("http://localhost/");

      try {
        await router.fetch(req);
      } catch {
        // Expected to throw
      }

      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should return JSON content-type header", async () => {
      mockDb = createMockDrizzleDb({ selectResult: SAMPLE_USERS });
      vi.mocked(drizzle).mockReturnValue(mockDb as never);

      const schema = buildRuntimeSchema(
        TEST_TABLE_NAMES.USERS,
        USERS_TABLE_COLUMNS
      );
      const router = createCrudRouter(
        TEST_TABLE_NAMES.USERS,
        schema.table,
        TEST_CONNECTION_STRING
      );

      const req = new Request("http://localhost/");
      const res = await router.fetch(req);

      expect(res.headers.get("content-type")).toContain("application/json");
    });
  });

  // Note: POST endpoint tests are omitted due to complex Zod validation from drizzle-zod + @hono/zod-openapi
  // These require integration testing with a real database to properly validate request bodies

  describe("OpenAPI Schema Generation", () => {
    it("should generate valid OpenAPI routes", () => {
      mockDb = createMockDrizzleDb();
      vi.mocked(drizzle).mockReturnValue(mockDb as never);

      const schema = buildRuntimeSchema(
        TEST_TABLE_NAMES.USERS,
        USERS_TABLE_COLUMNS
      );
      const router = createCrudRouter(
        TEST_TABLE_NAMES.USERS,
        schema.table,
        TEST_CONNECTION_STRING
      );

      // The router should be created without throwing
      expect(router).toBeDefined();
    });

    it("should handle different table schemas", () => {
      mockDb = createMockDrizzleDb();
      vi.mocked(drizzle).mockReturnValue(mockDb as never);

      const schema1 = buildRuntimeSchema(
        TEST_TABLE_NAMES.USERS,
        USERS_TABLE_COLUMNS
      );
      const router1 = createCrudRouter(
        TEST_TABLE_NAMES.USERS,
        schema1.table,
        TEST_CONNECTION_STRING
      );

      const schema2 = buildRuntimeSchema(TEST_TABLE_NAMES.PRODUCTS, [
        { name: "id", type: "integer", nullable: false },
        { name: "name", type: "text", nullable: false },
      ]);
      const router2 = createCrudRouter(
        TEST_TABLE_NAMES.PRODUCTS,
        schema2.table,
        TEST_CONNECTION_STRING
      );

      expect(router1).toBeDefined();
      expect(router2).toBeDefined();
    });
  });

  describe("Request/Response Format", () => {
    it("should handle nullable fields in responses", async () => {
      const userWithNullAge = { ...SAMPLE_USER, age: null };
      mockDb = createMockDrizzleDb({ selectResult: [userWithNullAge] });
      vi.mocked(drizzle).mockReturnValue(mockDb as never);

      const schema = buildRuntimeSchema(
        TEST_TABLE_NAMES.USERS,
        USERS_TABLE_COLUMNS
      );
      const router = createCrudRouter(
        TEST_TABLE_NAMES.USERS,
        schema.table,
        TEST_CONNECTION_STRING
      );

      const req = new Request("http://localhost/");
      const res = await router.fetch(req);

      const body = (await res.json()) as Record<string, unknown>[];
      expect(body[0]?.age).toBeNull();
    });

    it("should handle boolean fields correctly", async () => {
      mockDb = createMockDrizzleDb({ selectResult: SAMPLE_USERS });
      vi.mocked(drizzle).mockReturnValue(mockDb as never);

      const schema = buildRuntimeSchema(
        TEST_TABLE_NAMES.USERS,
        USERS_TABLE_COLUMNS
      );
      const router = createCrudRouter(
        TEST_TABLE_NAMES.USERS,
        schema.table,
        TEST_CONNECTION_STRING
      );

      const req = new Request("http://localhost/");
      const res = await router.fetch(req);

      const body = (await res.json()) as Record<string, unknown>[];
      expect(typeof body[0]?.is_active).toBe("boolean");
      expect(typeof body[2]?.is_active).toBe("boolean");
    });

    it("should handle timestamp fields as strings", async () => {
      mockDb = createMockDrizzleDb({ selectResult: SAMPLE_USERS });
      vi.mocked(drizzle).mockReturnValue(mockDb as never);

      const schema = buildRuntimeSchema(
        TEST_TABLE_NAMES.USERS,
        USERS_TABLE_COLUMNS
      );
      const router = createCrudRouter(
        TEST_TABLE_NAMES.USERS,
        schema.table,
        TEST_CONNECTION_STRING
      );

      const req = new Request("http://localhost/");
      const res = await router.fetch(req);

      const body = (await res.json()) as Record<string, unknown>[];
      expect(typeof body[0]?.created_at).toBe("string");
    });
  });
});
