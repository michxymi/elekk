import { describe, expect, it, vi } from "vitest";
import { buildRuntimeSchema } from "@/lib/builder";
import {
  executeUpdate,
  executeUpdateById,
  validateRequiredFields,
} from "@/lib/update-builder";
import { USERS_TABLE_COLUMNS } from "../setup/fixtures";
import { createMockUpdateBuilder } from "../setup/mocks";

describe("update-builder", () => {
  // Build runtime table for testing
  const { table: usersTable } = buildRuntimeSchema(
    "users",
    USERS_TABLE_COLUMNS
  );

  describe("validateRequiredFields", () => {
    it("should pass validation when all required fields are present", () => {
      // USERS_TABLE_COLUMNS has: name, email, is_active, created_at as required (non-nullable)
      const result = validateRequiredFields(
        {
          name: "John",
          email: "john@example.com",
          is_active: true,
          created_at: "2024-01-01T00:00:00Z",
        },
        USERS_TABLE_COLUMNS,
        "id"
      );
      expect(result.valid).toBe(true);
      expect(result.missingFields).toBeUndefined();
    });

    it("should fail validation when required field is missing", () => {
      const result = validateRequiredFields(
        { name: "John" }, // email, is_active, created_at are required but missing
        USERS_TABLE_COLUMNS,
        "id"
      );
      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain("email");
    });

    it("should not require nullable fields", () => {
      // age is nullable in USERS_TABLE_COLUMNS
      const result = validateRequiredFields(
        {
          name: "John",
          email: "john@example.com",
          is_active: true,
          created_at: "2024-01-01T00:00:00Z",
        }, // age not provided, which is fine since it's nullable
        USERS_TABLE_COLUMNS,
        "id"
      );
      expect(result.valid).toBe(true);
    });

    it("should skip primary key column validation", () => {
      // id is not provided, but it should be skipped
      const result = validateRequiredFields(
        {
          name: "John",
          email: "john@example.com",
          is_active: true,
          created_at: "2024-01-01T00:00:00Z",
        },
        USERS_TABLE_COLUMNS,
        "id"
      );
      expect(result.valid).toBe(true);
      expect(result.missingFields).toBeUndefined();
    });

    it("should return multiple missing fields", () => {
      const result = validateRequiredFields(
        {}, // all required fields are missing
        USERS_TABLE_COLUMNS,
        "id"
      );
      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain("name");
      expect(result.missingFields).toContain("email");
      expect(result.missingFields).toContain("is_active");
      expect(result.missingFields).toContain("created_at");
    });

    it("should handle empty columns array", () => {
      const result = validateRequiredFields({ name: "John" }, [], "id");
      expect(result.valid).toBe(true);
    });
  });

  describe("executeUpdate", () => {
    it("should execute basic update with default returning", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([
        { id: 1, name: "Updated" },
      ]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      const result = await executeUpdate(
        {
          db: mockDb,
          table: usersTable as never,
          data: { name: "Updated" },
          params: { filters: [] },
        },
        USERS_TABLE_COLUMNS
      );

      expect(mockDb.update).toHaveBeenCalledWith(usersTable);
      expect(mockUpdateBuilder._mocks.set).toHaveBeenCalled();
      expect(mockUpdateBuilder._mocks.returning).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1, name: "Updated" }]);
    });

    it("should execute update with WHERE clause", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([{ id: 1 }]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      await executeUpdate(
        {
          db: mockDb,
          table: usersTable as never,
          data: { name: "Updated" },
          params: {
            filters: [{ field: "id", operator: "eq", value: 1 }],
          },
        },
        USERS_TABLE_COLUMNS
      );

      expect(mockUpdateBuilder._mocks.where).toHaveBeenCalled();
    });

    it("should execute update with multiple filters (AND)", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      await executeUpdate(
        {
          db: mockDb,
          table: usersTable as never,
          data: { is_active: true },
          params: {
            filters: [
              { field: "is_active", operator: "eq", value: false },
              { field: "age", operator: "gte", value: 18 },
            ],
          },
        },
        USERS_TABLE_COLUMNS
      );

      expect(mockUpdateBuilder._mocks.where).toHaveBeenCalled();
    });

    it("should execute update with selective returning", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([{ id: 1 }]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      await executeUpdate(
        {
          db: mockDb,
          table: usersTable as never,
          data: { name: "Updated" },
          params: {
            filters: [{ field: "id", operator: "eq", value: 1 }],
            returning: ["id", "name"],
          },
        },
        USERS_TABLE_COLUMNS
      );

      const returningCall = mockUpdateBuilder._mocks.returning.mock.calls[0];
      expect(returningCall[0]).toHaveProperty("id");
      expect(returningCall[0]).toHaveProperty("name");
    });

    it("should return empty array when no records match", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      const result = await executeUpdate(
        {
          db: mockDb,
          table: usersTable as never,
          data: { name: "Updated" },
          params: {
            filters: [{ field: "id", operator: "eq", value: -999 }],
          },
        },
        USERS_TABLE_COLUMNS
      );

      expect(result).toEqual([]);
    });

    it("should filter out primary key from update data", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([{ id: 1 }]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      await executeUpdate(
        {
          db: mockDb,
          table: usersTable as never,
          data: { id: 999, name: "Updated" }, // id should be filtered out
          params: { filters: [] },
        },
        USERS_TABLE_COLUMNS
      );

      const setCall = mockUpdateBuilder._mocks.set.mock.calls[0][0];
      expect(setCall).not.toHaveProperty("id");
      expect(setCall).toHaveProperty("name", "Updated");
    });

    it("should filter out invalid columns from update data", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([{ id: 1 }]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      await executeUpdate(
        {
          db: mockDb,
          table: usersTable as never,
          data: { name: "Updated", invalid_column: "value" },
          params: { filters: [] },
        },
        USERS_TABLE_COLUMNS
      );

      const setCall = mockUpdateBuilder._mocks.set.mock.calls[0][0];
      expect(setCall).not.toHaveProperty("invalid_column");
      expect(setCall).toHaveProperty("name", "Updated");
    });

    it("should return empty array if no valid columns to update", async () => {
      const mockDb = {
        update: vi.fn(),
      };

      const result = await executeUpdate(
        {
          db: mockDb,
          table: usersTable as never,
          data: { invalid_column: "value" }, // no valid columns
          params: { filters: [] },
        },
        USERS_TABLE_COLUMNS
      );

      expect(result).toEqual([]);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe("executeUpdateById", () => {
    it("should update by primary key", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([{ id: 1 }]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      const result = await executeUpdateById(
        {
          db: mockDb,
          table: usersTable as never,
          data: { name: "Updated" },
          params: {},
        },
        1,
        USERS_TABLE_COLUMNS
      );

      expect(mockDb.update).toHaveBeenCalledWith(usersTable);
      expect(mockUpdateBuilder._mocks.where).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1 }]);
    });

    it("should handle string ID", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([{ id: 123 }]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      await executeUpdateById(
        {
          db: mockDb,
          table: usersTable as never,
          data: { name: "Updated" },
          params: {},
        },
        "123",
        USERS_TABLE_COLUMNS
      );

      expect(mockUpdateBuilder._mocks.where).toHaveBeenCalled();
    });

    it("should apply returning from params", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([{ id: 1 }]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      await executeUpdateById(
        {
          db: mockDb,
          table: usersTable as never,
          data: { name: "Updated" },
          params: { returning: ["id", "name"] },
        },
        1,
        USERS_TABLE_COLUMNS
      );

      const returningCall = mockUpdateBuilder._mocks.returning.mock.calls[0];
      expect(returningCall[0]).toHaveProperty("id");
      expect(returningCall[0]).toHaveProperty("name");
    });

    it("should throw error for invalid primary key column", () => {
      const mockDb = {
        update: vi.fn(),
      };

      expect(() =>
        executeUpdateById(
          {
            db: mockDb,
            table: usersTable as never,
            data: { name: "Updated" },
            params: {},
          },
          1,
          USERS_TABLE_COLUMNS,
          "invalid_pk_column"
        )
      ).toThrow("Primary key column invalid_pk_column not found");
    });

    it("should use custom primary key column", async () => {
      const { table: customTable } = buildRuntimeSchema("custom", [
        { name: "user_id", type: "integer", nullable: false },
        { name: "name", type: "text", nullable: false },
      ]);

      const mockUpdateBuilder = createMockUpdateBuilder([{ user_id: 1 }]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      await executeUpdateById(
        {
          db: mockDb,
          table: customTable as never,
          data: { name: "Updated" },
          params: {},
        },
        1,
        [
          { name: "user_id", type: "integer", nullable: false },
          { name: "name", type: "text", nullable: false },
        ],
        "user_id"
      );

      expect(mockUpdateBuilder._mocks.where).toHaveBeenCalled();
    });

    it("should return empty array when record not found", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      const result = await executeUpdateById(
        {
          db: mockDb,
          table: usersTable as never,
          data: { name: "Updated" },
          params: {},
        },
        -999,
        USERS_TABLE_COLUMNS
      );

      expect(result).toEqual([]);
    });
  });
});
