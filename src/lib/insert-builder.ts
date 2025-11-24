import { sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { OnConflictConfig, ParsedInsertParams } from "./insert-params";

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
 * Builds a returning columns map for selective RETURNING clause
 *
 * @param table - The Drizzle PgTable instance
 * @param fields - Array of field names to return
 * @returns Record of field names to column references
 *
 * @example
 * buildReturningColumns(usersTable, ["id", "name", "email"])
 * // Returns: { id: usersTable.id, name: usersTable.name, email: usersTable.email }
 */
export const buildReturningColumns = (
  table: PgTable,
  fields: string[]
): Record<string, PgColumn> => {
  const returningMap: Record<string, PgColumn> = {};

  for (const field of fields) {
    const column = getColumn(table, field);
    if (column) {
      returningMap[field] = column;
    }
  }

  return returningMap;
};

/**
 * Builds an update set object for ON CONFLICT DO UPDATE using EXCLUDED values
 *
 * @param table - The Drizzle PgTable instance
 * @param updateColumns - Array of column names to update
 * @returns Record mapping column references to EXCLUDED.column_name SQL expressions
 *
 * @example
 * buildUpdateSet(usersTable, ["name", "updated_at"])
 * // Returns: { name: sql`excluded.name`, updated_at: sql`excluded.updated_at` }
 */
export const buildUpdateSet = (
  table: PgTable,
  updateColumns: string[]
): Record<string, ReturnType<typeof sql>> => {
  const updateSet: Record<string, ReturnType<typeof sql>> = {};

  for (const columnName of updateColumns) {
    const column = getColumn(table, columnName);
    if (column) {
      // Use EXCLUDED.column_name to reference the value that would have been inserted
      updateSet[columnName] = sql.raw(`excluded.${columnName}`);
    }
  }

  return updateSet;
};

/**
 * Options for INSERT query execution
 */
export type InsertExecutionOptions = {
  /** The Drizzle database instance */
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db types are complex
  db: any;
  /** The Drizzle PgTable instance */
  table: PgTable;
  /** The data to insert */
  data: unknown;
  /** Parsed INSERT parameters (returning, onConflict) */
  params: ParsedInsertParams;
};

/**
 * Applies ON CONFLICT behavior to an insert query
 *
 * @param insertQuery - The Drizzle insert query builder
 * @param table - The Drizzle PgTable instance
 * @param onConflict - The ON CONFLICT configuration
 * @returns The modified insert query with conflict handling
 */
const applyOnConflict = (
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder types are complex
  insertQuery: any,
  table: PgTable,
  onConflict: OnConflictConfig
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder types are complex
): any => {
  const conflictColumn = getColumn(table, onConflict.column);
  if (!conflictColumn) {
    return insertQuery;
  }

  if (onConflict.action === "nothing") {
    return insertQuery.onConflictDoNothing({ target: conflictColumn });
  }

  if (onConflict.action === "update" && onConflict.updateColumns) {
    const updateSet = buildUpdateSet(table, onConflict.updateColumns);
    if (Object.keys(updateSet).length > 0) {
      return insertQuery.onConflictDoUpdate({
        target: conflictColumn,
        set: updateSet,
      });
    }
    // No valid update columns, fall back to do nothing
    return insertQuery.onConflictDoNothing({ target: conflictColumn });
  }

  return insertQuery;
};

/**
 * Applies RETURNING clause to an insert query
 *
 * @param insertQuery - The Drizzle insert query builder
 * @param table - The Drizzle PgTable instance
 * @param returning - Array of field names to return
 * @returns Promise resolving to query results
 */
const applyReturning = (
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder types are complex
  insertQuery: any,
  table: PgTable,
  returning?: string[]
): Promise<unknown[]> => {
  if (!returning) {
    return insertQuery.returning();
  }

  const returningColumns = buildReturningColumns(table, returning);
  if (Object.keys(returningColumns).length > 0) {
    return insertQuery.returning(returningColumns);
  }

  return insertQuery.returning();
};

/**
 * Executes an INSERT query with the parsed parameters applied
 *
 * This is the main entry point for executing INSERT operations with
 * optional RETURNING field selection and ON CONFLICT (upsert) behavior.
 *
 * @param options - Insert execution options
 * @returns Promise resolving to array of inserted/upserted records
 *
 * @example
 * // Basic insert with selective returning
 * const results = await executeInsert({
 *   db: drizzleDb,
 *   table: usersTable,
 *   data: { name: "John", email: "john@example.com" },
 *   params: { returning: ["id", "name"] }
 * });
 *
 * @example
 * // Upsert with ON CONFLICT DO UPDATE
 * const results = await executeInsert({
 *   db: drizzleDb,
 *   table: usersTable,
 *   data: { name: "John", email: "john@example.com" },
 *   params: {
 *     returning: ["id"],
 *     onConflict: {
 *       column: "email",
 *       action: "update",
 *       updateColumns: ["name", "updated_at"]
 *     }
 *   }
 * });
 *
 * @example
 * // Upsert with ON CONFLICT DO NOTHING
 * const results = await executeInsert({
 *   db: drizzleDb,
 *   table: usersTable,
 *   data: { name: "John", email: "john@example.com" },
 *   params: {
 *     onConflict: { column: "email", action: "nothing" }
 *   }
 * });
 */
export const executeInsert = (
  options: InsertExecutionOptions
): Promise<unknown[]> => {
  const { db, table, data, params } = options;

  // Start building the insert query
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder types are complex
  let insertQuery: any = db.insert(table).values(data);

  // Apply ON CONFLICT behavior if configured
  if (params.onConflict) {
    insertQuery = applyOnConflict(insertQuery, table, params.onConflict);
  }

  // Apply RETURNING clause and execute
  return applyReturning(insertQuery, table, params.returning);
};
