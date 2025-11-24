import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  buildFilterCondition,
  buildOrderByClause,
  buildSelectColumns,
  buildSortExpression,
  buildWhereClause,
} from "@/lib/query-builder";
import type { FilterCondition, SortDirective } from "@/lib/query-params";

// Create a test table for testing
const testTable = pgTable("test_users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  age: integer("age"),
  is_active: boolean("is_active").notNull(),
  created_at: timestamp("created_at").notNull(),
});

describe("query-builder", () => {
  describe("buildFilterCondition", () => {
    it("should build eq filter condition", () => {
      const filter: FilterCondition = {
        field: "name",
        operator: "eq",
        value: "John",
      };
      const result = buildFilterCondition(testTable, filter);
      expect(result).toBeDefined();
      // Drizzle SQL objects are complex, just verify it's created
    });

    it("should build gt filter condition", () => {
      const filter: FilterCondition = {
        field: "age",
        operator: "gt",
        value: 18,
      };
      const result = buildFilterCondition(testTable, filter);
      expect(result).toBeDefined();
    });

    it("should build gte filter condition", () => {
      const filter: FilterCondition = {
        field: "age",
        operator: "gte",
        value: 18,
      };
      const result = buildFilterCondition(testTable, filter);
      expect(result).toBeDefined();
    });

    it("should build lt filter condition", () => {
      const filter: FilterCondition = {
        field: "age",
        operator: "lt",
        value: 65,
      };
      const result = buildFilterCondition(testTable, filter);
      expect(result).toBeDefined();
    });

    it("should build lte filter condition", () => {
      const filter: FilterCondition = {
        field: "age",
        operator: "lte",
        value: 65,
      };
      const result = buildFilterCondition(testTable, filter);
      expect(result).toBeDefined();
    });

    it("should build like filter condition", () => {
      const filter: FilterCondition = {
        field: "name",
        operator: "like",
        value: "%John%",
      };
      const result = buildFilterCondition(testTable, filter);
      expect(result).toBeDefined();
    });

    it("should build ilike filter condition", () => {
      const filter: FilterCondition = {
        field: "email",
        operator: "ilike",
        value: "%@gmail.com",
      };
      const result = buildFilterCondition(testTable, filter);
      expect(result).toBeDefined();
    });

    it("should build in filter condition", () => {
      const filter: FilterCondition = {
        field: "name",
        operator: "in",
        value: ["John", "Jane", "Bob"],
      };
      const result = buildFilterCondition(testTable, filter);
      expect(result).toBeDefined();
    });

    it("should build isnull filter condition (true = IS NULL)", () => {
      const filter: FilterCondition = {
        field: "age",
        operator: "isnull",
        value: true,
      };
      const result = buildFilterCondition(testTable, filter);
      expect(result).toBeDefined();
    });

    it("should build isnull filter condition (false = IS NOT NULL)", () => {
      const filter: FilterCondition = {
        field: "age",
        operator: "isnull",
        value: false,
      };
      const result = buildFilterCondition(testTable, filter);
      expect(result).toBeDefined();
    });

    it("should return undefined for non-existent column", () => {
      const filter: FilterCondition = {
        field: "nonexistent",
        operator: "eq",
        value: "test",
      };
      const result = buildFilterCondition(testTable, filter);
      expect(result).toBeUndefined();
    });
  });

  describe("buildWhereClause", () => {
    it("should return undefined for empty filters", () => {
      const result = buildWhereClause(testTable, []);
      expect(result).toBeUndefined();
    });

    it("should build single filter condition", () => {
      const filters: FilterCondition[] = [
        { field: "name", operator: "eq", value: "John" },
      ];
      const result = buildWhereClause(testTable, filters);
      expect(result).toBeDefined();
    });

    it("should combine multiple filters with AND", () => {
      const filters: FilterCondition[] = [
        { field: "name", operator: "eq", value: "John" },
        { field: "age", operator: "gte", value: 18 },
        { field: "is_active", operator: "eq", value: true },
      ];
      const result = buildWhereClause(testTable, filters);
      expect(result).toBeDefined();
    });

    it("should ignore invalid filters", () => {
      const filters: FilterCondition[] = [
        { field: "name", operator: "eq", value: "John" },
        { field: "nonexistent", operator: "eq", value: "test" },
      ];
      const result = buildWhereClause(testTable, filters);
      expect(result).toBeDefined();
    });

    it("should return undefined if all filters are invalid", () => {
      const filters: FilterCondition[] = [
        { field: "nonexistent1", operator: "eq", value: "test" },
        { field: "nonexistent2", operator: "eq", value: "test" },
      ];
      const result = buildWhereClause(testTable, filters);
      expect(result).toBeUndefined();
    });
  });

  describe("buildSortExpression", () => {
    it("should build ascending sort expression", () => {
      const directive: SortDirective = { field: "name", direction: "asc" };
      const result = buildSortExpression(testTable, directive);
      expect(result).toBeDefined();
    });

    it("should build descending sort expression", () => {
      const directive: SortDirective = {
        field: "created_at",
        direction: "desc",
      };
      const result = buildSortExpression(testTable, directive);
      expect(result).toBeDefined();
    });

    it("should return undefined for non-existent column", () => {
      const directive: SortDirective = {
        field: "nonexistent",
        direction: "asc",
      };
      const result = buildSortExpression(testTable, directive);
      expect(result).toBeUndefined();
    });
  });

  describe("buildOrderByClause", () => {
    it("should return empty array for empty directives", () => {
      const result = buildOrderByClause(testTable, []);
      expect(result).toEqual([]);
    });

    it("should build single sort expression", () => {
      const directives: SortDirective[] = [{ field: "name", direction: "asc" }];
      const result = buildOrderByClause(testTable, directives);
      expect(result).toHaveLength(1);
    });

    it("should build multiple sort expressions", () => {
      const directives: SortDirective[] = [
        { field: "name", direction: "asc" },
        { field: "created_at", direction: "desc" },
      ];
      const result = buildOrderByClause(testTable, directives);
      expect(result).toHaveLength(2);
    });

    it("should filter out invalid sort expressions", () => {
      const directives: SortDirective[] = [
        { field: "name", direction: "asc" },
        { field: "nonexistent", direction: "desc" },
      ];
      const result = buildOrderByClause(testTable, directives);
      expect(result).toHaveLength(1);
    });
  });

  describe("buildSelectColumns", () => {
    it("should return empty object for empty fields", () => {
      const result = buildSelectColumns(testTable, []);
      expect(result).toEqual({});
    });

    it("should build select map for valid fields", () => {
      const result = buildSelectColumns(testTable, ["id", "name", "email"]);
      expect(Object.keys(result)).toEqual(["id", "name", "email"]);
      expect(result.id).toBeDefined();
      expect(result.name).toBeDefined();
      expect(result.email).toBeDefined();
    });

    it("should filter out invalid fields", () => {
      const result = buildSelectColumns(testTable, [
        "id",
        "nonexistent",
        "name",
      ]);
      expect(Object.keys(result)).toEqual(["id", "name"]);
    });

    it("should return all columns when all are valid", () => {
      const result = buildSelectColumns(testTable, [
        "id",
        "name",
        "email",
        "age",
        "is_active",
        "created_at",
      ]);
      expect(Object.keys(result)).toHaveLength(6);
    });
  });
});
