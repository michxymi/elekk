import { describe, expect, it, vi } from "vitest";
import { buildRuntimeSchema } from "@/lib/builder";
import {
  buildReturningColumns,
  buildUpdateSet,
  executeInsert,
} from "@/lib/insert-builder";
import { USERS_TABLE_COLUMNS } from "../setup/fixtures";
import { createMockInsertBuilder } from "../setup/mocks";

describe("insert-builder", () => {
  // Build a runtime table for testing
  const { table: usersTable } = buildRuntimeSchema(
    "users",
    USERS_TABLE_COLUMNS
  );

  describe("buildReturningColumns", () => {
    it("should build returning map for valid fields", () => {
      const result = buildReturningColumns(usersTable as never, [
        "id",
        "name",
        "email",
      ]);

      expect(Object.keys(result)).toEqual(["id", "name", "email"]);
      expect(result.id).toBeDefined();
      expect(result.name).toBeDefined();
      expect(result.email).toBeDefined();
    });

    it("should filter out invalid fields", () => {
      const result = buildReturningColumns(usersTable as never, [
        "id",
        "invalid_column",
        "name",
      ]);

      expect(Object.keys(result)).toEqual(["id", "name"]);
    });

    it("should return empty object for all invalid fields", () => {
      const result = buildReturningColumns(usersTable as never, [
        "invalid1",
        "invalid2",
      ]);

      expect(Object.keys(result)).toEqual([]);
    });

    it("should return empty object for empty fields array", () => {
      const result = buildReturningColumns(usersTable as never, []);

      expect(Object.keys(result)).toEqual([]);
    });

    it("should handle single field", () => {
      const result = buildReturningColumns(usersTable as never, ["id"]);

      expect(Object.keys(result)).toEqual(["id"]);
    });
  });

  describe("buildUpdateSet", () => {
    it("should build update set for valid columns", () => {
      const result = buildUpdateSet(usersTable as never, ["name", "email"]);

      expect(Object.keys(result)).toEqual(["name", "email"]);
      // The values should be SQL expressions for excluded.column_name
      expect(result.name).toBeDefined();
      expect(result.email).toBeDefined();
    });

    it("should filter out invalid columns", () => {
      const result = buildUpdateSet(usersTable as never, [
        "name",
        "invalid_column",
        "email",
      ]);

      expect(Object.keys(result)).toEqual(["name", "email"]);
    });

    it("should return empty object for all invalid columns", () => {
      const result = buildUpdateSet(usersTable as never, [
        "invalid1",
        "invalid2",
      ]);

      expect(Object.keys(result)).toEqual([]);
    });

    it("should return empty object for empty columns array", () => {
      const result = buildUpdateSet(usersTable as never, []);

      expect(Object.keys(result)).toEqual([]);
    });

    it("should handle single column", () => {
      const result = buildUpdateSet(usersTable as never, ["name"]);

      expect(Object.keys(result)).toEqual(["name"]);
    });

    it("should create SQL objects for update columns", () => {
      const result = buildUpdateSet(usersTable as never, ["name"]);

      // The result should contain a Drizzle SQL object
      expect(result.name).toBeDefined();
      // Drizzle SQL objects have a queryChunks property
      expect(result.name).toHaveProperty("queryChunks");
    });
  });

  describe("executeInsert", () => {
    it("should execute basic insert with default returning", async () => {
      const mockInsertBuilder = createMockInsertBuilder([
        { id: 1, name: "Test" },
      ]);
      const mockDb = {
        insert: vi.fn().mockReturnValue(mockInsertBuilder),
      };

      const result = await executeInsert({
        db: mockDb,
        table: usersTable as never,
        data: { name: "Test" },
        params: {},
      });

      expect(mockDb.insert).toHaveBeenCalledWith(usersTable);
      expect(mockInsertBuilder.values).toHaveBeenCalledWith({ name: "Test" });
      expect(mockInsertBuilder._mocks.returning).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1, name: "Test" }]);
    });

    it("should execute insert with selective returning", async () => {
      const mockInsertBuilder = createMockInsertBuilder([{ id: 1 }]);
      const mockDb = {
        insert: vi.fn().mockReturnValue(mockInsertBuilder),
      };

      const result = await executeInsert({
        db: mockDb,
        table: usersTable as never,
        data: { name: "Test", email: "test@example.com" },
        params: { returning: ["id", "name"] },
      });

      expect(mockInsertBuilder._mocks.returning).toHaveBeenCalled();
      // The returning should be called with a column map
      const returningCall = mockInsertBuilder._mocks.returning.mock.calls[0];
      expect(returningCall[0]).toHaveProperty("id");
      expect(returningCall[0]).toHaveProperty("name");
      expect(result).toEqual([{ id: 1 }]);
    });

    it("should execute insert with on_conflict do nothing", async () => {
      const mockInsertBuilder = createMockInsertBuilder([]);
      const mockDb = {
        insert: vi.fn().mockReturnValue(mockInsertBuilder),
      };

      await executeInsert({
        db: mockDb,
        table: usersTable as never,
        data: { name: "Test", email: "test@example.com" },
        params: {
          onConflict: {
            column: "email",
            action: "nothing",
          },
        },
      });

      expect(mockInsertBuilder._mocks.onConflictDoNothing).toHaveBeenCalled();
      // The target should be the email column
      const conflictCall =
        mockInsertBuilder._mocks.onConflictDoNothing.mock.calls[0];
      expect(conflictCall[0]).toHaveProperty("target");
    });

    it("should execute insert with on_conflict do update", async () => {
      const mockInsertBuilder = createMockInsertBuilder([
        { id: 1, name: "Updated" },
      ]);
      const mockDb = {
        insert: vi.fn().mockReturnValue(mockInsertBuilder),
      };

      await executeInsert({
        db: mockDb,
        table: usersTable as never,
        data: { name: "Test", email: "test@example.com" },
        params: {
          onConflict: {
            column: "email",
            action: "update",
            updateColumns: ["name"],
          },
        },
      });

      expect(mockInsertBuilder._mocks.onConflictDoUpdate).toHaveBeenCalled();
      const conflictCall =
        mockInsertBuilder._mocks.onConflictDoUpdate.mock.calls[0];
      expect(conflictCall[0]).toHaveProperty("target");
      expect(conflictCall[0]).toHaveProperty("set");
    });

    it("should fall back to do nothing when update columns are invalid", async () => {
      const mockInsertBuilder = createMockInsertBuilder([]);
      const mockDb = {
        insert: vi.fn().mockReturnValue(mockInsertBuilder),
      };

      await executeInsert({
        db: mockDb,
        table: usersTable as never,
        data: { name: "Test", email: "test@example.com" },
        params: {
          onConflict: {
            column: "email",
            action: "update",
            updateColumns: ["invalid_column"],
          },
        },
      });

      // Should fall back to onConflictDoNothing since no valid update columns
      expect(mockInsertBuilder._mocks.onConflictDoNothing).toHaveBeenCalled();
      expect(
        mockInsertBuilder._mocks.onConflictDoUpdate
      ).not.toHaveBeenCalled();
    });

    it("should ignore on_conflict with invalid conflict column", async () => {
      const mockInsertBuilder = createMockInsertBuilder([{ id: 1 }]);
      const mockDb = {
        insert: vi.fn().mockReturnValue(mockInsertBuilder),
      };

      await executeInsert({
        db: mockDb,
        table: usersTable as never,
        data: { name: "Test" },
        params: {
          onConflict: {
            column: "invalid_column",
            action: "nothing",
          },
        },
      });

      // Should not call onConflict methods since column is invalid
      expect(
        mockInsertBuilder._mocks.onConflictDoNothing
      ).not.toHaveBeenCalled();
      expect(
        mockInsertBuilder._mocks.onConflictDoUpdate
      ).not.toHaveBeenCalled();
    });

    it("should fall back to default returning when all fields are invalid", async () => {
      const mockInsertBuilder = createMockInsertBuilder([{ id: 1 }]);
      const mockDb = {
        insert: vi.fn().mockReturnValue(mockInsertBuilder),
      };

      await executeInsert({
        db: mockDb,
        table: usersTable as never,
        data: { name: "Test" },
        params: {
          returning: ["invalid1", "invalid2"],
        },
      });

      // Should call returning without arguments since no valid columns
      const returningCall = mockInsertBuilder._mocks.returning.mock.calls[0];
      expect(returningCall[0]).toBeUndefined();
    });

    it("should combine on_conflict and returning", async () => {
      const mockInsertBuilder = createMockInsertBuilder([{ id: 1 }]);
      const mockDb = {
        insert: vi.fn().mockReturnValue(mockInsertBuilder),
      };

      await executeInsert({
        db: mockDb,
        table: usersTable as never,
        data: { name: "Test", email: "test@example.com" },
        params: {
          returning: ["id"],
          onConflict: {
            column: "email",
            action: "update",
            updateColumns: ["name"],
          },
        },
      });

      expect(mockInsertBuilder._mocks.onConflictDoUpdate).toHaveBeenCalled();
      expect(mockInsertBuilder._mocks.returning).toHaveBeenCalled();
    });
  });
});
