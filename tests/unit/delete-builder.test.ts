import { describe, expect, it, vi } from "vitest";
import { buildRuntimeSchema } from "@/lib/builder";
import {
  executeDelete,
  executeDeleteById,
  executeHardDelete,
  executeSoftDelete,
} from "@/lib/delete-builder";
import {
  SOFT_DELETE_TABLE_COLUMNS,
  USERS_TABLE_COLUMNS,
} from "../setup/fixtures";
import {
  createMockDeleteBuilder,
  createMockUpdateBuilder,
} from "../setup/mocks";

describe("delete-builder", () => {
  // Build runtime tables for testing
  const { table: usersTable } = buildRuntimeSchema(
    "users",
    USERS_TABLE_COLUMNS
  );

  const { table: softDeleteTable } = buildRuntimeSchema(
    "soft_delete_users",
    SOFT_DELETE_TABLE_COLUMNS
  );

  describe("executeHardDelete", () => {
    it("should execute basic delete with default returning", async () => {
      const mockDeleteBuilder = createMockDeleteBuilder([
        { id: 1, name: "Deleted" },
      ]);
      const mockDb = {
        delete: vi.fn().mockReturnValue(mockDeleteBuilder),
      };

      const result = await executeHardDelete({
        db: mockDb,
        table: usersTable as never,
        params: { filters: [] },
      });

      expect(mockDb.delete).toHaveBeenCalledWith(usersTable);
      expect(mockDeleteBuilder._mocks.returning).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1, name: "Deleted" }]);
    });

    it("should execute delete with WHERE clause", async () => {
      const mockDeleteBuilder = createMockDeleteBuilder([{ id: 1 }]);
      const mockDb = {
        delete: vi.fn().mockReturnValue(mockDeleteBuilder),
      };

      await executeHardDelete({
        db: mockDb,
        table: usersTable as never,
        params: {
          filters: [{ field: "id", operator: "eq", value: 1 }],
        },
      });

      expect(mockDeleteBuilder._mocks.where).toHaveBeenCalled();
    });

    it("should execute delete with multiple filters (AND)", async () => {
      const mockDeleteBuilder = createMockDeleteBuilder([]);
      const mockDb = {
        delete: vi.fn().mockReturnValue(mockDeleteBuilder),
      };

      await executeHardDelete({
        db: mockDb,
        table: usersTable as never,
        params: {
          filters: [
            { field: "is_active", operator: "eq", value: false },
            { field: "age", operator: "lt", value: 18 },
          ],
        },
      });

      expect(mockDeleteBuilder._mocks.where).toHaveBeenCalled();
    });

    it("should execute delete with selective returning", async () => {
      const mockDeleteBuilder = createMockDeleteBuilder([{ id: 1 }]);
      const mockDb = {
        delete: vi.fn().mockReturnValue(mockDeleteBuilder),
      };

      await executeHardDelete({
        db: mockDb,
        table: usersTable as never,
        params: {
          filters: [{ field: "id", operator: "eq", value: 1 }],
          returning: ["id", "name"],
        },
      });

      const returningCall = mockDeleteBuilder._mocks.returning.mock.calls[0];
      expect(returningCall[0]).toHaveProperty("id");
      expect(returningCall[0]).toHaveProperty("name");
    });

    it("should return empty array when no records match", async () => {
      const mockDeleteBuilder = createMockDeleteBuilder([]);
      const mockDb = {
        delete: vi.fn().mockReturnValue(mockDeleteBuilder),
      };

      const result = await executeHardDelete({
        db: mockDb,
        table: usersTable as never,
        params: {
          filters: [{ field: "id", operator: "eq", value: -999 }],
        },
      });

      expect(result).toEqual([]);
    });
  });

  describe("executeSoftDelete", () => {
    it("should execute UPDATE instead of DELETE", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([
        { id: 1, deleted_at: "2024-01-01T00:00:00Z" },
      ]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      const result = await executeSoftDelete({
        db: mockDb,
        table: softDeleteTable as never,
        params: { filters: [{ field: "id", operator: "eq", value: 1 }] },
        softDeleteColumn: "deleted_at",
      });

      expect(mockDb.update).toHaveBeenCalledWith(softDeleteTable);
      expect(mockUpdateBuilder._mocks.set).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1, deleted_at: "2024-01-01T00:00:00Z" }]);
    });

    it("should apply WHERE clause for soft delete", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([{ id: 1 }]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
      };

      await executeSoftDelete({
        db: mockDb,
        table: softDeleteTable as never,
        params: {
          filters: [{ field: "id", operator: "eq", value: 1 }],
        },
        softDeleteColumn: "deleted_at",
      });

      expect(mockUpdateBuilder._mocks.where).toHaveBeenCalled();
    });

    it("should throw error if softDeleteColumn is not provided", () => {
      const mockDb = {
        update: vi.fn(),
      };

      expect(() =>
        executeSoftDelete({
          db: mockDb,
          table: softDeleteTable as never,
          params: { filters: [] },
          softDeleteColumn: undefined,
        })
      ).toThrow("softDeleteColumn is required for soft delete");
    });

    it("should throw error if soft delete column does not exist in table", () => {
      const mockDb = {
        update: vi.fn(),
      };

      expect(() =>
        executeSoftDelete({
          db: mockDb,
          table: usersTable as never, // users table doesn't have deleted_at
          params: { filters: [] },
          softDeleteColumn: "deleted_at",
        })
      ).toThrow("Column deleted_at not found in table");
    });
  });

  describe("executeDelete", () => {
    it("should use soft delete when softDeleteColumn is provided and hardDelete is false", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([{ id: 1 }]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
        delete: vi.fn(),
      };

      await executeDelete({
        db: mockDb,
        table: softDeleteTable as never,
        params: { filters: [{ field: "id", operator: "eq", value: 1 }] },
        softDeleteColumn: "deleted_at",
      });

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("should use hard delete when hardDelete is true", async () => {
      const mockDeleteBuilder = createMockDeleteBuilder([{ id: 1 }]);
      const mockDb = {
        update: vi.fn(),
        delete: vi.fn().mockReturnValue(mockDeleteBuilder),
      };

      await executeDelete({
        db: mockDb,
        table: softDeleteTable as never,
        params: {
          filters: [{ field: "id", operator: "eq", value: 1 }],
          hardDelete: true,
        },
        softDeleteColumn: "deleted_at",
      });

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("should use hard delete when no softDeleteColumn is provided", async () => {
      const mockDeleteBuilder = createMockDeleteBuilder([{ id: 1 }]);
      const mockDb = {
        update: vi.fn(),
        delete: vi.fn().mockReturnValue(mockDeleteBuilder),
      };

      await executeDelete({
        db: mockDb,
        table: usersTable as never,
        params: { filters: [{ field: "id", operator: "eq", value: 1 }] },
      });

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe("executeDeleteById", () => {
    it("should delete by primary key", async () => {
      const mockDeleteBuilder = createMockDeleteBuilder([{ id: 1 }]);
      const mockDb = {
        delete: vi.fn().mockReturnValue(mockDeleteBuilder),
      };

      const result = await executeDeleteById(
        {
          db: mockDb,
          table: usersTable as never,
          params: {},
        },
        1
      );

      expect(mockDb.delete).toHaveBeenCalledWith(usersTable);
      expect(mockDeleteBuilder._mocks.where).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1 }]);
    });

    it("should handle string ID", async () => {
      const mockDeleteBuilder = createMockDeleteBuilder([{ id: 123 }]);
      const mockDb = {
        delete: vi.fn().mockReturnValue(mockDeleteBuilder),
      };

      await executeDeleteById(
        {
          db: mockDb,
          table: usersTable as never,
          params: {},
        },
        "123"
      );

      expect(mockDeleteBuilder._mocks.where).toHaveBeenCalled();
    });

    it("should apply returning from params", async () => {
      const mockDeleteBuilder = createMockDeleteBuilder([{ id: 1 }]);
      const mockDb = {
        delete: vi.fn().mockReturnValue(mockDeleteBuilder),
      };

      await executeDeleteById(
        {
          db: mockDb,
          table: usersTable as never,
          params: { returning: ["id", "name"] },
        },
        1
      );

      const returningCall = mockDeleteBuilder._mocks.returning.mock.calls[0];
      expect(returningCall[0]).toHaveProperty("id");
      expect(returningCall[0]).toHaveProperty("name");
    });

    it("should use soft delete when softDeleteColumn is provided", async () => {
      const mockUpdateBuilder = createMockUpdateBuilder([{ id: 1 }]);
      const mockDb = {
        update: vi.fn().mockReturnValue(mockUpdateBuilder),
        delete: vi.fn(),
      };

      await executeDeleteById(
        {
          db: mockDb,
          table: softDeleteTable as never,
          params: {},
          softDeleteColumn: "deleted_at",
        },
        1
      );

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("should throw error for invalid primary key column", () => {
      const mockDb = {
        delete: vi.fn(),
      };

      expect(() =>
        executeDeleteById(
          {
            db: mockDb,
            table: usersTable as never,
            params: {},
          },
          1,
          "invalid_pk_column"
        )
      ).toThrow("Primary key column invalid_pk_column not found");
    });

    it("should use custom primary key column", async () => {
      const { table: customTable } = buildRuntimeSchema("custom", [
        { name: "user_id", type: "integer", nullable: false },
        { name: "name", type: "text", nullable: false },
      ]);

      const mockDeleteBuilder = createMockDeleteBuilder([{ user_id: 1 }]);
      const mockDb = {
        delete: vi.fn().mockReturnValue(mockDeleteBuilder),
      };

      await executeDeleteById(
        {
          db: mockDb,
          table: customTable as never,
          params: {},
        },
        1,
        "user_id"
      );

      expect(mockDeleteBuilder._mocks.where).toHaveBeenCalled();
    });
  });
});
