import { describe, expect, it } from "vitest";
import {
  hasUpdateParams,
  type ParsedUpdateParams,
  parseUpdateParams,
  UPDATE_RESERVED_PARAMS,
} from "@/lib/update-params";
import { USERS_TABLE_COLUMNS } from "../setup/fixtures";

describe("update-params", () => {
  describe("UPDATE_RESERVED_PARAMS", () => {
    it("should contain expected reserved parameter names", () => {
      expect(UPDATE_RESERVED_PARAMS).toContain("returning");
    });
  });

  describe("parseUpdateParams", () => {
    it("should parse empty params", () => {
      const result = parseUpdateParams({}, USERS_TABLE_COLUMNS);
      expect(result).toEqual({ filters: [] });
    });

    it("should parse single filter parameter", () => {
      const result = parseUpdateParams({ id: "1" }, USERS_TABLE_COLUMNS);
      expect(result.filters).toEqual([
        { field: "id", operator: "eq", value: 1 },
      ]);
    });

    it("should parse multiple filter parameters", () => {
      const result = parseUpdateParams(
        { is_active: "false", age__lt: "18" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(2);
      expect(result.filters).toContainEqual({
        field: "is_active",
        operator: "eq",
        value: false,
      });
      expect(result.filters).toContainEqual({
        field: "age",
        operator: "lt",
        value: 18,
      });
    });

    it("should parse filter with comparison operators", () => {
      const result = parseUpdateParams(
        { age__gte: "18", age__lte: "65" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toContainEqual({
        field: "age",
        operator: "gte",
        value: 18,
      });
      expect(result.filters).toContainEqual({
        field: "age",
        operator: "lte",
        value: 65,
      });
    });

    it("should parse filter with like operator", () => {
      const result = parseUpdateParams(
        { name__like: "%John%" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toEqual([
        { field: "name", operator: "like", value: "%John%" },
      ]);
    });

    it("should parse filter with ilike operator", () => {
      const result = parseUpdateParams(
        { email__ilike: "%@example.com" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toEqual([
        { field: "email", operator: "ilike", value: "%@example.com" },
      ]);
    });

    it("should parse filter with in operator", () => {
      const result = parseUpdateParams(
        { id__in: "1,2,3" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toEqual([
        { field: "id", operator: "in", value: [1, 2, 3] },
      ]);
    });

    it("should parse filter with isnull operator", () => {
      const result = parseUpdateParams(
        { age__isnull: "true" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toEqual([
        { field: "age", operator: "isnull", value: true },
      ]);
    });

    it("should ignore invalid column names in filters", () => {
      const result = parseUpdateParams(
        { id: "1", invalid_column: "value" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(1);
      expect(result.filters[0]?.field).toBe("id");
    });

    it("should parse returning parameter with valid columns", () => {
      const result = parseUpdateParams(
        { returning: "id,name,email" },
        USERS_TABLE_COLUMNS
      );
      expect(result.returning).toEqual(["id", "name", "email"]);
    });

    it("should filter invalid columns from returning", () => {
      const result = parseUpdateParams(
        { returning: "id,invalid_column,name" },
        USERS_TABLE_COLUMNS
      );
      expect(result.returning).toEqual(["id", "name"]);
    });

    it("should return undefined returning if all columns are invalid", () => {
      const result = parseUpdateParams(
        { returning: "invalid1,invalid2" },
        USERS_TABLE_COLUMNS
      );
      expect(result.returning).toBeUndefined();
    });

    it("should parse both filters and returning together", () => {
      const result = parseUpdateParams(
        { id: "1", returning: "id,name" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(1);
      expect(result.returning).toEqual(["id", "name"]);
    });

    it("should not treat returning as a filter", () => {
      const result = parseUpdateParams(
        { returning: "id,name" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(0);
      expect(result.returning).toEqual(["id", "name"]);
    });

    it("should ignore empty filter values", () => {
      const result = parseUpdateParams(
        { id: "", name: "John" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(1);
      expect(result.filters[0]?.field).toBe("name");
    });

    it("should handle whitespace in returning parameter", () => {
      const result = parseUpdateParams(
        { returning: " id , name , email " },
        USERS_TABLE_COLUMNS
      );
      expect(result.returning).toEqual(["id", "name", "email"]);
    });

    it("should ignore reserved GET params like order_by, limit, offset, select", () => {
      const result = parseUpdateParams(
        {
          id: "1",
          order_by: "name",
          limit: "10",
          offset: "0",
          select: "id,name",
        },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(1);
      expect(result.filters[0]?.field).toBe("id");
    });
  });

  describe("hasUpdateParams", () => {
    it("should return false for empty params", () => {
      const params: ParsedUpdateParams = { filters: [] };
      expect(hasUpdateParams(params)).toBe(false);
    });

    it("should return true if filters exist", () => {
      const params: ParsedUpdateParams = {
        filters: [{ field: "id", operator: "eq", value: 1 }],
      };
      expect(hasUpdateParams(params)).toBe(true);
    });

    it("should return true if returning exists", () => {
      const params: ParsedUpdateParams = {
        filters: [],
        returning: ["id", "name"],
      };
      expect(hasUpdateParams(params)).toBe(true);
    });

    it("should return true if both filters and returning exist", () => {
      const params: ParsedUpdateParams = {
        filters: [{ field: "id", operator: "eq", value: 1 }],
        returning: ["id"],
      };
      expect(hasUpdateParams(params)).toBe(true);
    });

    it("should return false for empty filters and no returning", () => {
      const params: ParsedUpdateParams = {
        filters: [],
        returning: undefined,
      };
      expect(hasUpdateParams(params)).toBe(false);
    });
  });
});
