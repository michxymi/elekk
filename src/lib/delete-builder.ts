import { sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { ParsedDeleteParams } from "./delete-params";
import { buildReturningColumns } from "./insert-builder";
import { buildWhereClause } from "./query-builder";

/**
 * Gets a column reference from a Drizzle table by column name
 *
 * @param table - The Drizzle PgTable instance
 * @param columnName - The name of the column to retrieve
 * @returns The PgColumn reference or undefined if not found
 */
const getColumn = (
  table: PgTable,
  columnName: string
): PgColumn | undefined => {
  const columns = table as unknown as Record<string, PgColumn>;
  return columns[columnName];
};

/**
 * Options for DELETE query execution
 */
export type DeleteExecutionOptions = {
  /** The Drizzle database instance */
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db types are complex
  db: any;
  /** The Drizzle PgTable instance */
  table: PgTable;
  /** Parsed DELETE parameters (filters, returning, hardDelete) */
  params: ParsedDeleteParams;
  /** Soft delete column name if detected */
  softDeleteColumn?: string;
};

/**
 * Applies RETURNING clause to a delete query
 *
 * @param deleteQuery - The Drizzle delete query builder
 * @param table - The Drizzle PgTable instance
 * @param returning - Array of field names to return
 * @returns Promise resolving to query results
 */
const applyReturning = (
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder types are complex
  deleteQuery: any,
  table: PgTable,
  returning?: string[]
): Promise<unknown[]> => {
  if (!returning) {
    return deleteQuery.returning();
  }

  const returningColumns = buildReturningColumns(table, returning);
  if (Object.keys(returningColumns).length > 0) {
    return deleteQuery.returning(returningColumns);
  }

  return deleteQuery.returning();
};

/**
 * Executes a soft DELETE by setting deleted_at column to current timestamp
 *
 * @param options - Delete execution options
 * @returns Promise resolving to array of updated records
 *
 * @example
 * const results = await executeSoftDelete({
 *   db: drizzleDb,
 *   table: usersTable,
 *   params: { filters: [{ field: "id", operator: "eq", value: 1 }] },
 *   softDeleteColumn: "deleted_at"
 * });
 */
export const executeSoftDelete = (
  options: DeleteExecutionOptions
): Promise<unknown[]> => {
  const { db, table, params, softDeleteColumn } = options;

  if (!softDeleteColumn) {
    throw new Error("softDeleteColumn is required for soft delete");
  }

  const column = getColumn(table, softDeleteColumn);
  if (!column) {
    throw new Error(`Column ${softDeleteColumn} not found in table`);
  }

  // Start building the update query
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder types are complex
  let updateQuery: any = db.update(table).set({
    [softDeleteColumn]: sql`NOW()`,
  });

  // Apply WHERE clause
  const whereClause = buildWhereClause(table, params.filters);
  if (whereClause) {
    updateQuery = updateQuery.where(whereClause);
  }

  // Apply RETURNING clause and execute
  return applyReturning(updateQuery, table, params.returning);
};

/**
 * Executes a hard DELETE (actual row deletion)
 *
 * @param options - Delete execution options
 * @returns Promise resolving to array of deleted records
 *
 * @example
 * const results = await executeHardDelete({
 *   db: drizzleDb,
 *   table: usersTable,
 *   params: { filters: [{ field: "id", operator: "eq", value: 1 }] }
 * });
 */
export const executeHardDelete = (
  options: DeleteExecutionOptions
): Promise<unknown[]> => {
  const { db, table, params } = options;

  // Start building the delete query
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder types are complex
  let deleteQuery: any = db.delete(table);

  // Apply WHERE clause
  const whereClause = buildWhereClause(table, params.filters);
  if (whereClause) {
    deleteQuery = deleteQuery.where(whereClause);
  }

  // Apply RETURNING clause and execute
  return applyReturning(deleteQuery, table, params.returning);
};

/**
 * Executes a DELETE query with the parsed parameters applied
 *
 * This is the main entry point for executing DELETE operations.
 * It automatically chooses between soft delete (UPDATE) and hard delete (DELETE)
 * based on whether the table has a soft delete column and the hardDelete flag.
 *
 * @param options - Delete execution options
 * @returns Promise resolving to array of deleted/updated records
 *
 * @example
 * // Hard delete by ID
 * const results = await executeDelete({
 *   db: drizzleDb,
 *   table: usersTable,
 *   params: { filters: [{ field: "id", operator: "eq", value: 1 }] }
 * });
 *
 * @example
 * // Soft delete (when table has deleted_at column)
 * const results = await executeDelete({
 *   db: drizzleDb,
 *   table: usersTable,
 *   params: { filters: [{ field: "id", operator: "eq", value: 1 }] },
 *   softDeleteColumn: "deleted_at"
 * });
 *
 * @example
 * // Force hard delete even with soft delete column
 * const results = await executeDelete({
 *   db: drizzleDb,
 *   table: usersTable,
 *   params: {
 *     filters: [{ field: "id", operator: "eq", value: 1 }],
 *     hardDelete: true
 *   },
 *   softDeleteColumn: "deleted_at"
 * });
 */
export const executeDelete = (
  options: DeleteExecutionOptions
): Promise<unknown[]> => {
  const { params, softDeleteColumn } = options;

  // Use soft delete if:
  // 1. Table has a soft delete column
  // 2. User hasn't requested hard delete
  if (softDeleteColumn && !params.hardDelete) {
    return executeSoftDelete(options);
  }

  // Otherwise, perform hard delete
  return executeHardDelete(options);
};

/**
 * Executes a DELETE by primary key (for /:id endpoint)
 *
 * @param options - Delete execution options with ID filter
 * @param id - The primary key value
 * @param primaryKeyColumn - The primary key column name (default: "id")
 * @returns Promise resolving to array with single deleted record or empty
 *
 * @example
 * const results = await executeDeleteById({
 *   db: drizzleDb,
 *   table: usersTable,
 *   params: { returning: ["id", "name"] }
 * }, "123", "id");
 */
export const executeDeleteById = (
  options: Omit<DeleteExecutionOptions, "params"> & {
    params: Omit<ParsedDeleteParams, "filters">;
  },
  id: string | number,
  primaryKeyColumn = "id"
): Promise<unknown[]> => {
  const { db, table, params, softDeleteColumn } = options;

  const column = getColumn(table, primaryKeyColumn);
  if (!column) {
    throw new Error(`Primary key column ${primaryKeyColumn} not found`);
  }

  // Coerce ID to number if column type suggests it
  const idValue = typeof id === "string" ? Number(id) || id : id;

  // Create params with ID filter
  const deleteParams: ParsedDeleteParams = {
    ...params,
    filters: [{ field: primaryKeyColumn, operator: "eq", value: idValue }],
  };

  return executeDelete({
    db,
    table,
    params: deleteParams,
    softDeleteColumn,
  });
};
