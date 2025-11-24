import { describe, expect, it } from "vitest";
import {
  coerceValue,
  generateQueryCacheKey,
  hasQueryParams,
  type ParsedQuery,
  parseFilterKey,
  parseQueryParams,
  parseSelectParam,
  parseSortParam,
} from "@/lib/query-params";
import { USERS_TABLE_COLUMNS } from "../setup/fixtures";

describe("query-params", () => {
  describe("parseFilterKey", () => {
    it("should parse simple field name as equality filter", () => {
      const result = parseFilterKey("name");
      expect(result).toEqual({ field: "name", operator: "eq" });
    });

    it("should parse field__gt as greater than filter", () => {
      const result = parseFilterKey("age__gt");
      expect(result).toEqual({ field: "age", operator: "gt" });
    });

    it("should parse field__gte as greater than or equal filter", () => {
      const result = parseFilterKey("age__gte");
      expect(result).toEqual({ field: "age", operator: "gte" });
    });

    it("should parse field__lt as less than filter", () => {
      const result = parseFilterKey("age__lt");
      expect(result).toEqual({ field: "age", operator: "lt" });
    });

    it("should parse field__lte as less than or equal filter", () => {
      const result = parseFilterKey("age__lte");
      expect(result).toEqual({ field: "age", operator: "lte" });
    });

    it("should parse field__like as LIKE filter", () => {
      const result = parseFilterKey("name__like");
      expect(result).toEqual({ field: "name", operator: "like" });
    });

    it("should parse field__ilike as ILIKE filter", () => {
      const result = parseFilterKey("email__ilike");
      expect(result).toEqual({ field: "email", operator: "ilike" });
    });

    it("should parse field__in as IN filter", () => {
      const result = parseFilterKey("status__in");
      expect(result).toEqual({ field: "status", operator: "in" });
    });

    it("should parse field__isnull as IS NULL filter", () => {
      const result = parseFilterKey("age__isnull");
      expect(result).toEqual({ field: "age", operator: "isnull" });
    });

    it("should return null for reserved params", () => {
      expect(parseFilterKey("order_by")).toBeNull();
      expect(parseFilterKey("limit")).toBeNull();
      expect(parseFilterKey("offset")).toBeNull();
      expect(parseFilterKey("select")).toBeNull();
    });

    it("should treat unknown operator as field name with eq", () => {
      const result = parseFilterKey("field__unknown");
      expect(result).toEqual({ field: "field__unknown", operator: "eq" });
    });

    it("should return null for empty string", () => {
      const result = parseFilterKey("");
      expect(result).toBeNull();
    });
  });

  describe("coerceValue", () => {
    it("should coerce string to number for integer type", () => {
      expect(coerceValue("42", "integer", "eq")).toBe(42);
      expect(coerceValue("0", "integer", "eq")).toBe(0);
      expect(coerceValue("-10", "integer", "eq")).toBe(-10);
    });

    it("should return original string for non-numeric integer values", () => {
      expect(coerceValue("not-a-number", "integer", "eq")).toBe("not-a-number");
    });

    it("should coerce string to boolean for boolean type", () => {
      expect(coerceValue("true", "boolean", "eq")).toBe(true);
      expect(coerceValue("1", "boolean", "eq")).toBe(true);
      expect(coerceValue("false", "boolean", "eq")).toBe(false);
      expect(coerceValue("0", "boolean", "eq")).toBe(false);
    });

    it("should keep string as-is for text type", () => {
      expect(coerceValue("hello", "text", "eq")).toBe("hello");
      expect(coerceValue("hello", "character varying", "eq")).toBe("hello");
    });

    it("should handle isnull operator specially", () => {
      expect(coerceValue("true", "integer", "isnull")).toBe(true);
      expect(coerceValue("1", "integer", "isnull")).toBe(true);
      expect(coerceValue("false", "integer", "isnull")).toBe(false);
    });

    it("should handle in operator by splitting and coercing each value", () => {
      expect(coerceValue("1,2,3", "integer", "in")).toEqual([1, 2, 3]);
      expect(coerceValue("a,b,c", "text", "in")).toEqual(["a", "b", "c"]);
      expect(coerceValue("  a , b , c  ", "text", "in")).toEqual([
        "a",
        "b",
        "c",
      ]);
    });

    it("should fallback to text coercion for unknown types", () => {
      expect(coerceValue("value", "unknown_type", "eq")).toBe("value");
    });
  });

  describe("parseSortParam", () => {
    it("should parse single ascending sort", () => {
      expect(parseSortParam("name")).toEqual([
        { field: "name", direction: "asc" },
      ]);
    });

    it("should parse single descending sort", () => {
      expect(parseSortParam("-created_at")).toEqual([
        { field: "created_at", direction: "desc" },
      ]);
    });

    it("should parse multiple sort directives", () => {
      expect(parseSortParam("name,-created_at,age")).toEqual([
        { field: "name", direction: "asc" },
        { field: "created_at", direction: "desc" },
        { field: "age", direction: "asc" },
      ]);
    });

    it("should handle whitespace in sort param", () => {
      expect(parseSortParam(" name , -age ")).toEqual([
        { field: "name", direction: "asc" },
        { field: "age", direction: "desc" },
      ]);
    });

    it("should return empty array for empty string", () => {
      expect(parseSortParam("")).toEqual([]);
      expect(parseSortParam("   ")).toEqual([]);
    });
  });

  describe("parseSelectParam", () => {
    it("should parse comma-separated field names", () => {
      expect(parseSelectParam("id,name,email")).toEqual([
        "id",
        "name",
        "email",
      ]);
    });

    it("should handle whitespace in select param", () => {
      expect(parseSelectParam(" id , name , email ")).toEqual([
        "id",
        "name",
        "email",
      ]);
    });

    it("should return empty array for empty string", () => {
      expect(parseSelectParam("")).toEqual([]);
      expect(parseSelectParam("   ")).toEqual([]);
    });

    it("should filter out empty parts", () => {
      expect(parseSelectParam("id,,name")).toEqual(["id", "name"]);
    });
  });

  describe("parseQueryParams", () => {
    it("should parse empty params", () => {
      const result = parseQueryParams({}, USERS_TABLE_COLUMNS);
      expect(result).toEqual({
        filters: [],
        sort: [],
      });
    });

    it("should parse simple equality filter", () => {
      const result = parseQueryParams({ name: "John" }, USERS_TABLE_COLUMNS);
      expect(result.filters).toEqual([
        { field: "name", operator: "eq", value: "John" },
      ]);
    });

    it("should coerce integer values", () => {
      const result = parseQueryParams({ age: "25" }, USERS_TABLE_COLUMNS);
      expect(result.filters).toEqual([
        { field: "age", operator: "eq", value: 25 },
      ]);
    });

    it("should coerce boolean values", () => {
      const result = parseQueryParams(
        { is_active: "true" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toEqual([
        { field: "is_active", operator: "eq", value: true },
      ]);
    });

    it("should parse multiple filters", () => {
      const result = parseQueryParams(
        { name: "John", age__gte: "18", is_active: "true" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(3);
      expect(result.filters).toContainEqual({
        field: "name",
        operator: "eq",
        value: "John",
      });
      expect(result.filters).toContainEqual({
        field: "age",
        operator: "gte",
        value: 18,
      });
      expect(result.filters).toContainEqual({
        field: "is_active",
        operator: "eq",
        value: true,
      });
    });

    it("should parse order_by parameter", () => {
      const result = parseQueryParams(
        { order_by: "-created_at" },
        USERS_TABLE_COLUMNS
      );
      expect(result.sort).toEqual([{ field: "created_at", direction: "desc" }]);
    });

    it("should parse limit parameter", () => {
      const result = parseQueryParams({ limit: "10" }, USERS_TABLE_COLUMNS);
      expect(result.limit).toBe(10);
    });

    it("should parse offset parameter", () => {
      const result = parseQueryParams({ offset: "20" }, USERS_TABLE_COLUMNS);
      expect(result.offset).toBe(20);
    });

    it("should parse select parameter with valid columns", () => {
      const result = parseQueryParams(
        { select: "id,name,email" },
        USERS_TABLE_COLUMNS
      );
      expect(result.select).toEqual(["id", "name", "email"]);
    });

    it("should filter out invalid columns from select", () => {
      const result = parseQueryParams(
        { select: "id,invalid_column,name" },
        USERS_TABLE_COLUMNS
      );
      expect(result.select).toEqual(["id", "name"]);
    });

    it("should ignore filters for non-existent columns", () => {
      const result = parseQueryParams(
        { invalid_column: "value" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toEqual([]);
    });

    it("should ignore empty values", () => {
      const result = parseQueryParams({ name: "" }, USERS_TABLE_COLUMNS);
      expect(result.filters).toEqual([]);
    });

    it("should ignore invalid limit values", () => {
      const result = parseQueryParams(
        { limit: "invalid" },
        USERS_TABLE_COLUMNS
      );
      expect(result.limit).toBeUndefined();

      const result2 = parseQueryParams({ limit: "-5" }, USERS_TABLE_COLUMNS);
      expect(result2.limit).toBeUndefined();
    });

    it("should ignore invalid offset values", () => {
      const result = parseQueryParams(
        { offset: "invalid" },
        USERS_TABLE_COLUMNS
      );
      expect(result.offset).toBeUndefined();

      const result2 = parseQueryParams({ offset: "-5" }, USERS_TABLE_COLUMNS);
      expect(result2.offset).toBeUndefined();
    });
  });

  describe("hasQueryParams", () => {
    it("should return false for empty query", () => {
      const query: ParsedQuery = { filters: [], sort: [] };
      expect(hasQueryParams(query)).toBe(false);
    });

    it("should return true if filters exist", () => {
      const query: ParsedQuery = {
        filters: [{ field: "name", operator: "eq", value: "John" }],
        sort: [],
      };
      expect(hasQueryParams(query)).toBe(true);
    });

    it("should return true if sort exists", () => {
      const query: ParsedQuery = {
        filters: [],
        sort: [{ field: "name", direction: "asc" }],
      };
      expect(hasQueryParams(query)).toBe(true);
    });

    it("should return true if limit exists", () => {
      const query: ParsedQuery = { filters: [], sort: [], limit: 10 };
      expect(hasQueryParams(query)).toBe(true);
    });

    it("should return true if offset exists", () => {
      const query: ParsedQuery = { filters: [], sort: [], offset: 0 };
      expect(hasQueryParams(query)).toBe(true);
    });

    it("should return true if select exists", () => {
      const query: ParsedQuery = {
        filters: [],
        sort: [],
        select: ["id", "name"],
      };
      expect(hasQueryParams(query)).toBe(true);
    });
  });

  describe("generateQueryCacheKey", () => {
    it("should return list cache key for empty query", () => {
      const query: ParsedQuery = { filters: [], sort: [] };
      expect(generateQueryCacheKey("users", query)).toBe("data:users:list");
    });

    it("should generate key with filter", () => {
      const query: ParsedQuery = {
        filters: [{ field: "name", operator: "eq", value: "John" }],
        sort: [],
      };
      expect(generateQueryCacheKey("users", query)).toBe(
        "data:users:query:f[name:eq:John]"
      );
    });

    it("should generate key with multiple filters sorted by field name", () => {
      const query: ParsedQuery = {
        filters: [
          { field: "name", operator: "eq", value: "John" },
          { field: "age", operator: "gte", value: 18 },
        ],
        sort: [],
      };
      // age comes before name alphabetically
      expect(generateQueryCacheKey("users", query)).toBe(
        "data:users:query:f[age:gte:18,name:eq:John]"
      );
    });

    it("should generate key with sort", () => {
      const query: ParsedQuery = {
        filters: [],
        sort: [{ field: "created_at", direction: "desc" }],
      };
      expect(generateQueryCacheKey("users", query)).toBe(
        "data:users:query:s[-created_at]"
      );
    });

    it("should generate key with limit and offset", () => {
      const query: ParsedQuery = {
        filters: [],
        sort: [],
        limit: 10,
        offset: 20,
      };
      expect(generateQueryCacheKey("users", query)).toBe(
        "data:users:query:l10;o20"
      );
    });

    it("should generate key with select (sorted)", () => {
      const query: ParsedQuery = {
        filters: [],
        sort: [],
        select: ["name", "id", "email"],
      };
      // Fields are sorted alphabetically in cache key
      expect(generateQueryCacheKey("users", query)).toBe(
        "data:users:query:c[email,id,name]"
      );
    });

    it("should generate deterministic key regardless of filter order", () => {
      const query1: ParsedQuery = {
        filters: [
          { field: "name", operator: "eq", value: "John" },
          { field: "age", operator: "gte", value: 18 },
        ],
        sort: [],
      };
      const query2: ParsedQuery = {
        filters: [
          { field: "age", operator: "gte", value: 18 },
          { field: "name", operator: "eq", value: "John" },
        ],
        sort: [],
      };
      expect(generateQueryCacheKey("users", query1)).toBe(
        generateQueryCacheKey("users", query2)
      );
    });

    it("should generate key with IN operator values joined by pipe", () => {
      const query: ParsedQuery = {
        filters: [{ field: "status", operator: "in", value: ["a", "b", "c"] }],
        sort: [],
      };
      expect(generateQueryCacheKey("users", query)).toBe(
        "data:users:query:f[status:in:a|b|c]"
      );
    });

    it("should generate complete key with all components", () => {
      const query: ParsedQuery = {
        filters: [{ field: "name", operator: "eq", value: "John" }],
        sort: [{ field: "created_at", direction: "desc" }],
        limit: 10,
        offset: 0,
        select: ["id", "name"],
      };
      expect(generateQueryCacheKey("users", query)).toBe(
        "data:users:query:f[name:eq:John];s[-created_at];l10;o0;c[id,name]"
      );
    });
  });
});
