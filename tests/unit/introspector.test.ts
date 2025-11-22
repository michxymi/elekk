import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEntireSchemaConfig,
  getTableConfig,
  getTableVersion,
} from "@/lib/introspector";
import {
  MOCK_ENTIRE_SCHEMA_RESULT,
  MOCK_TABLE_CONFIG_QUERY_RESULT,
  MOCK_TABLE_VERSION_RESULT,
  TEST_CONNECTION_STRING,
  TEST_TABLE_NAMES,
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

describe("introspector", () => {
  let mockClient: ReturnType<typeof createMockPostgresClient>;
  let mockDb: ReturnType<typeof createMockDrizzleDb>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = createMockPostgresClient();
    mockDb = createMockDrizzleDb();

    // Setup default mocks
    vi.mocked(postgres).mockReturnValue(mockClient as never);
    vi.mocked(drizzle).mockReturnValue(mockDb as never);
  });

  describe("getTableVersion", () => {
    it("should return version ID for existing table", async () => {
      mockDb.execute.mockResolvedValue(MOCK_TABLE_VERSION_RESULT);

      const result = await getTableVersion(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.USERS
      );

      expect(result).toBe("12345");
      expect(postgres).toHaveBeenCalledWith(TEST_CONNECTION_STRING);
      expect(drizzle).toHaveBeenCalledWith(mockClient);
      expect(mockDb.execute).toHaveBeenCalledOnce();
      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should return null when table does not exist", async () => {
      mockDb.execute.mockResolvedValue([]);

      const result = await getTableVersion(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.NONEXISTENT
      );

      expect(result).toBeNull();
      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should return null when version_id is not a string", async () => {
      mockDb.execute.mockResolvedValue([{ version_id: 12_345 }]); // number instead of string

      const result = await getTableVersion(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.USERS
      );

      expect(result).toBeNull();
      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should return null when version_id is undefined", async () => {
      mockDb.execute.mockResolvedValue([{ other_field: "value" }]);

      const result = await getTableVersion(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.USERS
      );

      expect(result).toBeNull();
      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should handle database errors gracefully", async () => {
      mockDb.execute.mockRejectedValue(new Error("Connection failed"));

      const result = await getTableVersion(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.USERS
      );

      expect(result).toBeNull();
      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should close connection even when query succeeds", async () => {
      mockDb.execute.mockResolvedValue(MOCK_TABLE_VERSION_RESULT);

      await getTableVersion(TEST_CONNECTION_STRING, TEST_TABLE_NAMES.USERS);

      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should close connection even when query fails", async () => {
      mockDb.execute.mockRejectedValue(new Error("Query failed"));

      await getTableVersion(TEST_CONNECTION_STRING, TEST_TABLE_NAMES.USERS);

      expect(mockClient.end).toHaveBeenCalledOnce();
    });
  });

  describe("getTableConfig", () => {
    it("should return column configurations for existing table", async () => {
      mockDb.execute.mockResolvedValue(MOCK_TABLE_CONFIG_QUERY_RESULT);

      const result = await getTableConfig(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.USERS
      );

      expect(result).toEqual([
        { name: "id", type: "integer", nullable: false },
        { name: "name", type: "text", nullable: false },
        { name: "email", type: "character varying", nullable: false },
        { name: "age", type: "integer", nullable: true },
      ]);
      expect(postgres).toHaveBeenCalledWith(TEST_CONNECTION_STRING);
      expect(drizzle).toHaveBeenCalledWith(mockClient);
      expect(mockDb.execute).toHaveBeenCalledOnce();
      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should return null when table does not exist", async () => {
      mockDb.execute.mockResolvedValue([]);

      const result = await getTableConfig(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.NONEXISTENT
      );

      expect(result).toBeNull();
      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should correctly parse nullable columns (is_nullable = YES)", async () => {
      mockDb.execute.mockResolvedValue([
        { column_name: "description", data_type: "text", is_nullable: "YES" },
      ]);

      const result = await getTableConfig(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.PRODUCTS
      );

      expect(result).toEqual([
        { name: "description", type: "text", nullable: true },
      ]);
    });

    it("should correctly parse non-nullable columns (is_nullable = NO)", async () => {
      mockDb.execute.mockResolvedValue([
        { column_name: "name", data_type: "text", is_nullable: "NO" },
      ]);

      const result = await getTableConfig(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.USERS
      );

      expect(result).toEqual([{ name: "name", type: "text", nullable: false }]);
    });

    it("should handle various PostgreSQL data types", async () => {
      mockDb.execute.mockResolvedValue([
        { column_name: "id", data_type: "integer", is_nullable: "NO" },
        { column_name: "name", data_type: "text", is_nullable: "NO" },
        {
          column_name: "email",
          data_type: "character varying",
          is_nullable: "NO",
        },
        { column_name: "is_active", data_type: "boolean", is_nullable: "NO" },
        {
          column_name: "created_at",
          data_type: "timestamp without time zone",
          is_nullable: "NO",
        },
      ]);

      const result = await getTableConfig(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.USERS
      );

      expect(result).toEqual([
        { name: "id", type: "integer", nullable: false },
        { name: "name", type: "text", nullable: false },
        { name: "email", type: "character varying", nullable: false },
        { name: "is_active", type: "boolean", nullable: false },
        {
          name: "created_at",
          type: "timestamp without time zone",
          nullable: false,
        },
      ]);
    });

    it("should handle database errors gracefully", async () => {
      mockDb.execute.mockRejectedValue(new Error("Connection failed"));

      const result = await getTableConfig(
        TEST_CONNECTION_STRING,
        TEST_TABLE_NAMES.USERS
      );

      expect(result).toBeNull();
      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should close connection even when query succeeds", async () => {
      mockDb.execute.mockResolvedValue(MOCK_TABLE_CONFIG_QUERY_RESULT);

      await getTableConfig(TEST_CONNECTION_STRING, TEST_TABLE_NAMES.USERS);

      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should close connection even when query fails", async () => {
      mockDb.execute.mockRejectedValue(new Error("Query failed"));

      await getTableConfig(TEST_CONNECTION_STRING, TEST_TABLE_NAMES.USERS);

      expect(mockClient.end).toHaveBeenCalledOnce();
    });
  });

  describe("getEntireSchemaConfig", () => {
    it("should return schema configuration for all tables", async () => {
      mockDb.execute.mockResolvedValue(MOCK_ENTIRE_SCHEMA_RESULT);

      const result = await getEntireSchemaConfig(TEST_CONNECTION_STRING);

      expect(result).toEqual({
        users: [
          { name: "id", type: "integer", nullable: false },
          { name: "name", type: "text", nullable: false },
        ],
        posts: [
          { name: "id", type: "integer", nullable: false },
          { name: "title", type: "text", nullable: false },
        ],
      });
      expect(postgres).toHaveBeenCalledWith(TEST_CONNECTION_STRING);
      expect(drizzle).toHaveBeenCalledWith(mockClient);
      expect(mockDb.execute).toHaveBeenCalledOnce();
      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should return empty object when no tables exist", async () => {
      mockDb.execute.mockResolvedValue([]);

      const result = await getEntireSchemaConfig(TEST_CONNECTION_STRING);

      expect(result).toEqual({});
      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should handle single table", async () => {
      mockDb.execute.mockResolvedValue([
        {
          table_name: "users",
          column_name: "id",
          data_type: "integer",
          is_nullable: "NO",
        },
        {
          table_name: "users",
          column_name: "name",
          data_type: "text",
          is_nullable: "NO",
        },
      ]);

      const result = await getEntireSchemaConfig(TEST_CONNECTION_STRING);

      expect(result).toEqual({
        users: [
          { name: "id", type: "integer", nullable: false },
          { name: "name", type: "text", nullable: false },
        ],
      });
    });

    it("should handle multiple tables with varying column counts", async () => {
      mockDb.execute.mockResolvedValue([
        {
          table_name: "users",
          column_name: "id",
          data_type: "integer",
          is_nullable: "NO",
        },
        {
          table_name: "users",
          column_name: "name",
          data_type: "text",
          is_nullable: "NO",
        },
        {
          table_name: "users",
          column_name: "email",
          data_type: "text",
          is_nullable: "NO",
        },
        {
          table_name: "posts",
          column_name: "id",
          data_type: "integer",
          is_nullable: "NO",
        },
      ]);

      const result = await getEntireSchemaConfig(TEST_CONNECTION_STRING);

      expect(result.users).toHaveLength(3);
      expect(result.posts).toHaveLength(1);
    });

    it("should correctly parse nullable columns across tables", async () => {
      mockDb.execute.mockResolvedValue([
        {
          table_name: "users",
          column_name: "id",
          data_type: "integer",
          is_nullable: "NO",
        },
        {
          table_name: "users",
          column_name: "bio",
          data_type: "text",
          is_nullable: "YES",
        },
        {
          table_name: "posts",
          column_name: "id",
          data_type: "integer",
          is_nullable: "NO",
        },
        {
          table_name: "posts",
          column_name: "content",
          data_type: "text",
          is_nullable: "YES",
        },
      ]);

      const result = await getEntireSchemaConfig(TEST_CONNECTION_STRING);

      expect(result.users?.[1]?.nullable).toBe(true);
      expect(result.posts?.[1]?.nullable).toBe(true);
      expect(result.users?.[0]?.nullable).toBe(false);
      expect(result.posts?.[0]?.nullable).toBe(false);
    });

    it("should throw error for database connection failures", async () => {
      mockDb.execute.mockRejectedValue(new Error("Connection failed"));

      await expect(
        getEntireSchemaConfig(TEST_CONNECTION_STRING)
      ).rejects.toThrow("Connection failed");

      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should close connection even when query succeeds", async () => {
      mockDb.execute.mockResolvedValue(MOCK_ENTIRE_SCHEMA_RESULT);

      await getEntireSchemaConfig(TEST_CONNECTION_STRING);

      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should close connection even when query fails", async () => {
      mockDb.execute.mockRejectedValue(new Error("Query failed"));

      try {
        await getEntireSchemaConfig(TEST_CONNECTION_STRING);
      } catch {
        // Expected to throw
      }

      expect(mockClient.end).toHaveBeenCalledOnce();
    });

    it("should build tables incrementally as rows are processed", async () => {
      mockDb.execute.mockResolvedValue([
        {
          table_name: "new_table",
          column_name: "col1",
          data_type: "text",
          is_nullable: "NO",
        },
        {
          table_name: "new_table",
          column_name: "col2",
          data_type: "integer",
          is_nullable: "NO",
        },
      ]);

      const result = await getEntireSchemaConfig(TEST_CONNECTION_STRING);

      expect(result.new_table).toBeDefined();
      expect(result.new_table).toHaveLength(2);
      expect(result.new_table?.[0]?.name).toBe("col1");
      expect(result.new_table?.[1]?.name).toBe("col2");
    });
  });
});
