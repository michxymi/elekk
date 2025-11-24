import { describe, expect, it } from "vitest";
import {
  hasInsertParams,
  type ParsedInsertParams,
  parseInsertParams,
  parseOnConflictParams,
  parseOnConflictUpdateParam,
  parseReturningParam,
} from "@/lib/insert-params";
import { USERS_TABLE_COLUMNS } from "../setup/fixtures";

describe("insert-params", () => {
  describe("parseReturningParam", () => {
    it("should parse comma-separated field names", () => {
      expect(parseReturningParam("id,name,email")).toEqual([
        "id",
        "name",
        "email",
      ]);
    });

    it("should parse single field name", () => {
      expect(parseReturningParam("id")).toEqual(["id"]);
    });

    it("should handle whitespace in returning param", () => {
      expect(parseReturningParam(" id , name , email ")).toEqual([
        "id",
        "name",
        "email",
      ]);
    });

    it("should return empty array for empty string", () => {
      expect(parseReturningParam("")).toEqual([]);
      expect(parseReturningParam("   ")).toEqual([]);
    });

    it("should filter out empty parts", () => {
      expect(parseReturningParam("id,,name")).toEqual(["id", "name"]);
    });
  });

  describe("parseOnConflictUpdateParam", () => {
    it("should parse comma-separated column names", () => {
      expect(parseOnConflictUpdateParam("name,updated_at")).toEqual([
        "name",
        "updated_at",
      ]);
    });

    it("should parse single column name", () => {
      expect(parseOnConflictUpdateParam("name")).toEqual(["name"]);
    });

    it("should handle whitespace", () => {
      expect(parseOnConflictUpdateParam(" name , updated_at ")).toEqual([
        "name",
        "updated_at",
      ]);
    });

    it("should return empty array for empty string", () => {
      expect(parseOnConflictUpdateParam("")).toEqual([]);
      expect(parseOnConflictUpdateParam("   ")).toEqual([]);
    });
  });

  describe("parseOnConflictParams", () => {
    const columnMap = new Map(
      USERS_TABLE_COLUMNS.map((col) => [col.name, col])
    );

    it("should return undefined when on_conflict is not provided", () => {
      expect(parseOnConflictParams({}, columnMap)).toBeUndefined();
    });

    it("should return undefined when on_conflict column does not exist", () => {
      expect(
        parseOnConflictParams({ on_conflict: "invalid_column" }, columnMap)
      ).toBeUndefined();
    });

    it("should parse on_conflict with action=nothing", () => {
      expect(
        parseOnConflictParams(
          { on_conflict: "email", on_conflict_action: "nothing" },
          columnMap
        )
      ).toEqual({
        column: "email",
        action: "nothing",
      });
    });

    it("should parse on_conflict with on_conflict_update (implies action=update)", () => {
      expect(
        parseOnConflictParams(
          { on_conflict: "email", on_conflict_update: "name,age" },
          columnMap
        )
      ).toEqual({
        column: "email",
        action: "update",
        updateColumns: ["name", "age"],
      });
    });

    it("should filter invalid columns from on_conflict_update", () => {
      expect(
        parseOnConflictParams(
          {
            on_conflict: "email",
            on_conflict_update: "name,invalid_column,age",
          },
          columnMap
        )
      ).toEqual({
        column: "email",
        action: "update",
        updateColumns: ["name", "age"],
      });
    });

    it("should fall back to nothing if all update columns are invalid", () => {
      expect(
        parseOnConflictParams(
          { on_conflict: "email", on_conflict_update: "invalid1,invalid2" },
          columnMap
        )
      ).toEqual({
        column: "email",
        action: "nothing",
      });
    });

    it("should default to nothing when only on_conflict is provided", () => {
      expect(
        parseOnConflictParams({ on_conflict: "email" }, columnMap)
      ).toEqual({
        column: "email",
        action: "nothing",
      });
    });

    it("should handle whitespace in on_conflict column", () => {
      expect(
        parseOnConflictParams({ on_conflict: " email " }, columnMap)
      ).toEqual({
        column: "email",
        action: "nothing",
      });
    });

    it("should be case-insensitive for on_conflict_action", () => {
      expect(
        parseOnConflictParams(
          { on_conflict: "email", on_conflict_action: "NOTHING" },
          columnMap
        )
      ).toEqual({
        column: "email",
        action: "nothing",
      });
    });
  });

  describe("parseInsertParams", () => {
    it("should parse empty params", () => {
      const result = parseInsertParams({}, USERS_TABLE_COLUMNS);
      expect(result).toEqual({});
    });

    it("should parse returning parameter with valid columns", () => {
      const result = parseInsertParams(
        { returning: "id,name,email" },
        USERS_TABLE_COLUMNS
      );
      expect(result.returning).toEqual(["id", "name", "email"]);
    });

    it("should filter invalid columns from returning", () => {
      const result = parseInsertParams(
        { returning: "id,invalid_column,name" },
        USERS_TABLE_COLUMNS
      );
      expect(result.returning).toEqual(["id", "name"]);
    });

    it("should return undefined returning if all columns are invalid", () => {
      const result = parseInsertParams(
        { returning: "invalid1,invalid2" },
        USERS_TABLE_COLUMNS
      );
      expect(result.returning).toBeUndefined();
    });

    it("should parse on_conflict with action nothing", () => {
      const result = parseInsertParams(
        { on_conflict: "email", on_conflict_action: "nothing" },
        USERS_TABLE_COLUMNS
      );
      expect(result.onConflict).toEqual({
        column: "email",
        action: "nothing",
      });
    });

    it("should parse on_conflict with update columns", () => {
      const result = parseInsertParams(
        { on_conflict: "email", on_conflict_update: "name,age" },
        USERS_TABLE_COLUMNS
      );
      expect(result.onConflict).toEqual({
        column: "email",
        action: "update",
        updateColumns: ["name", "age"],
      });
    });

    it("should parse both returning and on_conflict together", () => {
      const result = parseInsertParams(
        {
          returning: "id,name",
          on_conflict: "email",
          on_conflict_update: "name",
        },
        USERS_TABLE_COLUMNS
      );
      expect(result).toEqual({
        returning: ["id", "name"],
        onConflict: {
          column: "email",
          action: "update",
          updateColumns: ["name"],
        },
      });
    });
  });

  describe("hasInsertParams", () => {
    it("should return false for empty params", () => {
      const params: ParsedInsertParams = {};
      expect(hasInsertParams(params)).toBe(false);
    });

    it("should return true if returning exists", () => {
      const params: ParsedInsertParams = { returning: ["id", "name"] };
      expect(hasInsertParams(params)).toBe(true);
    });

    it("should return true if onConflict exists", () => {
      const params: ParsedInsertParams = {
        onConflict: { column: "email", action: "nothing" },
      };
      expect(hasInsertParams(params)).toBe(true);
    });

    it("should return true if both returning and onConflict exist", () => {
      const params: ParsedInsertParams = {
        returning: ["id"],
        onConflict: {
          column: "email",
          action: "update",
          updateColumns: ["name"],
        },
      };
      expect(hasInsertParams(params)).toBe(true);
    });
  });
});
