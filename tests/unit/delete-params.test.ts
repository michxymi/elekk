import { describe, expect, it } from "vitest";
import {
  detectSoftDeleteColumn,
  hasDeleteParams,
  type ParsedDeleteParams,
  parseDeleteParams,
  SOFT_DELETE_COLUMNS,
} from "@/lib/delete-params";
import {
  IS_DELETED_TABLE_COLUMNS,
  SOFT_DELETE_TABLE_COLUMNS,
  USERS_TABLE_COLUMNS,
} from "../setup/fixtures";

describe("delete-params", () => {
  describe("SOFT_DELETE_COLUMNS", () => {
    it("should contain expected soft delete column names", () => {
      expect(SOFT_DELETE_COLUMNS).toContain("deleted_at");
      expect(SOFT_DELETE_COLUMNS).toContain("is_deleted");
    });
  });

  describe("detectSoftDeleteColumn", () => {
    it("should detect deleted_at column", () => {
      expect(detectSoftDeleteColumn(SOFT_DELETE_TABLE_COLUMNS)).toBe(
        "deleted_at"
      );
    });

    it("should detect is_deleted column", () => {
      expect(detectSoftDeleteColumn(IS_DELETED_TABLE_COLUMNS)).toBe(
        "is_deleted"
      );
    });

    it("should return undefined when no soft delete column exists", () => {
      expect(detectSoftDeleteColumn(USERS_TABLE_COLUMNS)).toBeUndefined();
    });

    it("should return first soft delete column found", () => {
      const columnsWithBoth = [
        { name: "id", type: "integer", nullable: false },
        {
          name: "deleted_at",
          type: "timestamp without time zone",
          nullable: true,
        },
        { name: "is_deleted", type: "boolean", nullable: false },
      ];
      // deleted_at comes first in SOFT_DELETE_COLUMNS
      expect(detectSoftDeleteColumn(columnsWithBoth)).toBe("deleted_at");
    });

    it("should return undefined for empty columns array", () => {
      expect(detectSoftDeleteColumn([])).toBeUndefined();
    });
  });

  describe("parseDeleteParams", () => {
    it("should parse empty params", () => {
      const result = parseDeleteParams({}, USERS_TABLE_COLUMNS);
      expect(result).toEqual({ filters: [] });
    });

    it("should parse single filter parameter", () => {
      const result = parseDeleteParams({ id: "1" }, USERS_TABLE_COLUMNS);
      expect(result.filters).toEqual([
        { field: "id", operator: "eq", value: 1 },
      ]);
    });

    it("should parse multiple filter parameters", () => {
      const result = parseDeleteParams(
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
      const result = parseDeleteParams(
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
      const result = parseDeleteParams(
        { name__like: "%John%" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toEqual([
        { field: "name", operator: "like", value: "%John%" },
      ]);
    });

    it("should parse filter with in operator", () => {
      const result = parseDeleteParams(
        { id__in: "1,2,3" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toEqual([
        { field: "id", operator: "in", value: [1, 2, 3] },
      ]);
    });

    it("should parse filter with isnull operator", () => {
      const result = parseDeleteParams(
        { age__isnull: "true" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toEqual([
        { field: "age", operator: "isnull", value: true },
      ]);
    });

    it("should ignore invalid column names in filters", () => {
      const result = parseDeleteParams(
        { id: "1", invalid_column: "value" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(1);
      expect(result.filters[0]?.field).toBe("id");
    });

    it("should parse returning parameter with valid columns", () => {
      const result = parseDeleteParams(
        { returning: "id,name,email" },
        USERS_TABLE_COLUMNS
      );
      expect(result.returning).toEqual(["id", "name", "email"]);
    });

    it("should filter invalid columns from returning", () => {
      const result = parseDeleteParams(
        { returning: "id,invalid_column,name" },
        USERS_TABLE_COLUMNS
      );
      expect(result.returning).toEqual(["id", "name"]);
    });

    it("should return undefined returning if all columns are invalid", () => {
      const result = parseDeleteParams(
        { returning: "invalid1,invalid2" },
        USERS_TABLE_COLUMNS
      );
      expect(result.returning).toBeUndefined();
    });

    it("should parse hard_delete parameter as true", () => {
      const result = parseDeleteParams(
        { hard_delete: "true" },
        USERS_TABLE_COLUMNS
      );
      expect(result.hardDelete).toBe(true);
    });

    it("should parse hard_delete=1 as true", () => {
      const result = parseDeleteParams(
        { hard_delete: "1" },
        USERS_TABLE_COLUMNS
      );
      expect(result.hardDelete).toBe(true);
    });

    it("should not set hardDelete for false value", () => {
      const result = parseDeleteParams(
        { hard_delete: "false" },
        USERS_TABLE_COLUMNS
      );
      expect(result.hardDelete).toBeUndefined();
    });

    it("should not set hardDelete when not provided", () => {
      const result = parseDeleteParams({}, USERS_TABLE_COLUMNS);
      expect(result.hardDelete).toBeUndefined();
    });

    it("should parse both filters and returning together", () => {
      const result = parseDeleteParams(
        { id: "1", returning: "id,name" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(1);
      expect(result.returning).toEqual(["id", "name"]);
    });

    it("should parse filters, returning, and hard_delete together", () => {
      const result = parseDeleteParams(
        { id: "1", returning: "id,name", hard_delete: "true" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(1);
      expect(result.returning).toEqual(["id", "name"]);
      expect(result.hardDelete).toBe(true);
    });

    it("should not treat returning as a filter", () => {
      const result = parseDeleteParams(
        { returning: "id,name" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(0);
      expect(result.returning).toEqual(["id", "name"]);
    });

    it("should not treat hard_delete as a filter", () => {
      const result = parseDeleteParams(
        { hard_delete: "true" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(0);
    });

    it("should ignore empty filter values", () => {
      const result = parseDeleteParams(
        { id: "", name: "John" },
        USERS_TABLE_COLUMNS
      );
      expect(result.filters).toHaveLength(1);
      expect(result.filters[0]?.field).toBe("name");
    });
  });

  describe("hasDeleteParams", () => {
    it("should return false for empty params", () => {
      const params: ParsedDeleteParams = { filters: [] };
      expect(hasDeleteParams(params)).toBe(false);
    });

    it("should return true if filters exist", () => {
      const params: ParsedDeleteParams = {
        filters: [{ field: "id", operator: "eq", value: 1 }],
      };
      expect(hasDeleteParams(params)).toBe(true);
    });

    it("should return true if returning exists", () => {
      const params: ParsedDeleteParams = {
        filters: [],
        returning: ["id", "name"],
      };
      expect(hasDeleteParams(params)).toBe(true);
    });

    it("should return true if hardDelete is true", () => {
      const params: ParsedDeleteParams = {
        filters: [],
        hardDelete: true,
      };
      expect(hasDeleteParams(params)).toBe(true);
    });

    it("should return false if hardDelete is false", () => {
      const params: ParsedDeleteParams = {
        filters: [],
        hardDelete: false,
      };
      expect(hasDeleteParams(params)).toBe(false);
    });

    it("should return true if all params exist", () => {
      const params: ParsedDeleteParams = {
        filters: [{ field: "id", operator: "eq", value: 1 }],
        returning: ["id"],
        hardDelete: true,
      };
      expect(hasDeleteParams(params)).toBe(true);
    });
  });
});
