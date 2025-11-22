import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildRuntimeSchema } from "@/lib/builder";
import type { ColumnConfig } from "@/types";
import {
  EMPTY_TABLE_COLUMNS,
  POSTS_TABLE_COLUMNS,
  PRODUCTS_TABLE_COLUMNS,
  TABLE_WITH_UNKNOWN_TYPE,
  TABLE_WITHOUT_ID,
  USERS_TABLE_COLUMNS,
} from "../setup/fixtures";

describe("buildRuntimeSchema", () => {
  describe("Type Mappings", () => {
    it("should map integer type to Drizzle integer and Zod number", () => {
      const columns: ColumnConfig[] = [
        { name: "age", type: "integer", nullable: false },
      ];

      const result = buildRuntimeSchema("test", columns);

      expect(result.zodSchema.shape.age).toBeInstanceOf(z.ZodNumber);
    });

    it("should map text type to Drizzle text and Zod string", () => {
      const columns: ColumnConfig[] = [
        { name: "name", type: "text", nullable: false },
      ];

      const result = buildRuntimeSchema("test", columns);

      expect(result.zodSchema.shape.name).toBeInstanceOf(z.ZodString);
    });

    it("should map character varying to Drizzle text and Zod string", () => {
      const columns: ColumnConfig[] = [
        { name: "email", type: "character varying", nullable: false },
      ];

      const result = buildRuntimeSchema("test", columns);

      expect(result.zodSchema.shape.email).toBeInstanceOf(z.ZodString);
    });

    it("should map boolean type to Drizzle boolean and Zod boolean", () => {
      const columns: ColumnConfig[] = [
        { name: "is_active", type: "boolean", nullable: false },
      ];

      const result = buildRuntimeSchema("test", columns);

      expect(result.zodSchema.shape.is_active).toBeInstanceOf(z.ZodBoolean);
    });

    it("should map timestamp without time zone to Drizzle timestamp and Zod string", () => {
      const columns: ColumnConfig[] = [
        {
          name: "created_at",
          type: "timestamp without time zone",
          nullable: false,
        },
      ];

      const result = buildRuntimeSchema("test", columns);

      expect(result.zodSchema.shape.created_at).toBeInstanceOf(z.ZodString);
    });

    it("should fallback to text/string for unknown PostgreSQL types", () => {
      const result = buildRuntimeSchema("test", TABLE_WITH_UNKNOWN_TYPE);

      // jsonb and geography are not in DRIZZLE_MAP, should fallback to text/string
      expect(result.zodSchema.shape.data).toBeInstanceOf(z.ZodNullable);
      expect(result.zodSchema.shape.location).toBeInstanceOf(z.ZodNullable);
    });
  });

  describe("Primary Key Detection", () => {
    it("should detect 'id' column as primary key", () => {
      const result = buildRuntimeSchema("users", USERS_TABLE_COLUMNS);

      // Verify table is created with proper structure
      expect(result.table).toBeDefined();
      expect(result.zodSchema.shape.id).toBeDefined();
    });

    it("should handle tables without 'id' column", () => {
      const result = buildRuntimeSchema("test", TABLE_WITHOUT_ID);

      expect(result.table).toBeDefined();
      expect(result.zodSchema.shape.user_id).toBeDefined();
      expect(result.zodSchema.shape.id).toBeUndefined();
    });
  });

  describe("Nullable Handling", () => {
    it("should make nullable columns optional in Zod schema", () => {
      const columns: ColumnConfig[] = [
        { name: "id", type: "integer", nullable: false },
        { name: "description", type: "text", nullable: true },
      ];

      const result = buildRuntimeSchema("test", columns);

      // Non-nullable should be regular Zod type
      expect(result.zodSchema.shape.id).toBeInstanceOf(z.ZodNumber);

      // Nullable should be wrapped in ZodNullable
      expect(result.zodSchema.shape.description).toBeInstanceOf(z.ZodNullable);
    });

    it("should handle mix of nullable and non-nullable columns", () => {
      const result = buildRuntimeSchema("users", USERS_TABLE_COLUMNS);

      // Non-nullable columns
      expect(result.zodSchema.shape.id).toBeInstanceOf(z.ZodNumber);
      expect(result.zodSchema.shape.name).toBeInstanceOf(z.ZodString);
      expect(result.zodSchema.shape.email).toBeInstanceOf(z.ZodString);

      // Nullable column
      expect(result.zodSchema.shape.age).toBeInstanceOf(z.ZodNullable);
    });

    it("should allow null values for nullable columns", () => {
      const result = buildRuntimeSchema("users", USERS_TABLE_COLUMNS);

      // Test that nullable age accepts null
      const validData = {
        id: 1,
        name: "Test",
        email: "test@example.com",
        age: null, // Should be valid
        is_active: true,
        created_at: "2024-01-01T00:00:00.000Z",
      };

      const parsed = result.zodSchema.parse(validData);
      expect(parsed.age).toBeNull();
    });

    it("should reject null values for non-nullable columns", () => {
      const result = buildRuntimeSchema("users", USERS_TABLE_COLUMNS);

      const invalidData = {
        id: 1,
        name: null, // Should be invalid
        email: "test@example.com",
        age: 30,
        is_active: true,
        created_at: "2024-01-01T00:00:00.000Z",
      };

      expect(() => result.zodSchema.parse(invalidData)).toThrow();
    });
  });

  describe("Schema Structure", () => {
    it("should return RuntimeSchema with table and zodSchema", () => {
      const result = buildRuntimeSchema("users", USERS_TABLE_COLUMNS);

      expect(result).toHaveProperty("table");
      expect(result).toHaveProperty("zodSchema");
      expect(result.zodSchema).toBeInstanceOf(z.ZodObject);
    });

    it("should create schema with all column names", () => {
      const result = buildRuntimeSchema("users", USERS_TABLE_COLUMNS);

      const columnNames = [
        "id",
        "name",
        "email",
        "age",
        "is_active",
        "created_at",
      ];
      for (const name of columnNames) {
        expect(result.zodSchema.shape[name]).toBeDefined();
      }
    });

    it("should validate correct data structure", () => {
      const result = buildRuntimeSchema("products", PRODUCTS_TABLE_COLUMNS);

      const validProduct = {
        id: 1,
        title: "Test Product",
        description: "A test description",
        price: 1999,
        in_stock: true,
      };

      expect(() => result.zodSchema.parse(validProduct)).not.toThrow();
    });

    it("should reject invalid data types", () => {
      const result = buildRuntimeSchema("products", PRODUCTS_TABLE_COLUMNS);

      const invalidProduct = {
        id: "not-a-number", // Should be number
        title: "Test Product",
        description: "A test description",
        price: 1999,
        in_stock: true,
      };

      expect(() => result.zodSchema.parse(invalidProduct)).toThrow();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty columns array", () => {
      const result = buildRuntimeSchema("empty", EMPTY_TABLE_COLUMNS);

      expect(result.table).toBeDefined();
      expect(result.zodSchema).toBeInstanceOf(z.ZodObject);
      expect(Object.keys(result.zodSchema.shape)).toHaveLength(0);
    });

    it("should handle single column table", () => {
      const columns: ColumnConfig[] = [
        { name: "id", type: "integer", nullable: false },
      ];

      const result = buildRuntimeSchema("simple", columns);

      expect(result.table).toBeDefined();
      expect(Object.keys(result.zodSchema.shape)).toHaveLength(1);
      expect(result.zodSchema.shape.id).toBeDefined();
    });

    it("should handle table with many columns", () => {
      const manyColumns: ColumnConfig[] = Array.from(
        { length: 20 },
        (_, i) => ({
          name: `col_${i}`,
          type: "text",
          nullable: false,
        })
      );

      const result = buildRuntimeSchema("large", manyColumns);

      expect(Object.keys(result.zodSchema.shape)).toHaveLength(20);
    });

    it("should preserve column order in schema", () => {
      const result = buildRuntimeSchema("posts", POSTS_TABLE_COLUMNS);

      const shapeKeys = Object.keys(result.zodSchema.shape);
      expect(shapeKeys).toEqual(["id", "title", "content", "published"]);
    });
  });

  describe("Integration with Real Column Configs", () => {
    it("should build schema for users table", () => {
      const result = buildRuntimeSchema("users", USERS_TABLE_COLUMNS);

      expect(result.table).toBeDefined();
      expect(result.zodSchema.shape.id).toBeInstanceOf(z.ZodNumber);
      expect(result.zodSchema.shape.name).toBeInstanceOf(z.ZodString);
      expect(result.zodSchema.shape.email).toBeInstanceOf(z.ZodString);
      expect(result.zodSchema.shape.age).toBeInstanceOf(z.ZodNullable);
      expect(result.zodSchema.shape.is_active).toBeInstanceOf(z.ZodBoolean);
      expect(result.zodSchema.shape.created_at).toBeInstanceOf(z.ZodString);
    });

    it("should build schema for products table", () => {
      const result = buildRuntimeSchema("products", PRODUCTS_TABLE_COLUMNS);

      expect(result.table).toBeDefined();
      expect(result.zodSchema.shape.id).toBeInstanceOf(z.ZodNumber);
      expect(result.zodSchema.shape.title).toBeInstanceOf(z.ZodString);
      expect(result.zodSchema.shape.description).toBeInstanceOf(z.ZodNullable);
      expect(result.zodSchema.shape.price).toBeInstanceOf(z.ZodNumber);
      expect(result.zodSchema.shape.in_stock).toBeInstanceOf(z.ZodBoolean);
    });

    it("should build schema for posts table", () => {
      const result = buildRuntimeSchema("posts", POSTS_TABLE_COLUMNS);

      expect(result.table).toBeDefined();
      expect(result.zodSchema.shape.id).toBeInstanceOf(z.ZodNumber);
      expect(result.zodSchema.shape.title).toBeInstanceOf(z.ZodString);
      expect(result.zodSchema.shape.content).toBeInstanceOf(z.ZodNullable);
      expect(result.zodSchema.shape.published).toBeInstanceOf(z.ZodBoolean);
    });
  });
});
