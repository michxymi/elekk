import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { ColumnConfig } from "@/types";
import { buildReturningColumns } from "./insert-builder";
import { buildWhereClause } from "./query-builder";
import type { ParsedUpdateParams } from "./update-params";

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
 * Options for UPDATE query execution
 */
export type UpdateExecutionOptions = {
  /** The Drizzle database instance */
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db types are complex
  db: any;
  /** The Drizzle PgTable instance */
  table: PgTable;
  /** The data to update (set values) */
  data: Record<string, unknown>;
  /** Parsed UPDATE parameters (filters, returning) */
  params: ParsedUpdateParams;
};

/**
 * Result of required field validation
 */
export type ValidationResult = {
  /** Whether validation passed */
  valid: boolean;
  /** Missing field names if validation failed */
  missingFields?: string[];
};

/**
 * Validates that all required (non-nullable) fields are present in the data
 * for PUT operations (full replacement)
 *
 * @param data - The update data to validate
 * @param columns - Column metadata for the table
 * @param primaryKeyColumn - The primary key column name (excluded from validation)
 * @returns ValidationResult indicating if all required fields are present
 *
 * @example
 * validateRequiredFields(
 *   { name: "John", email: "john@example.com" },
 *   [
 *     { name: "id", type: "integer", nullable: false },
 *     { name: "name", type: "text", nullable: false },
 *     { name: "email", type: "text", nullable: false },
 *     { name: "age", type: "integer", nullable: true }
 *   ],
 *   "id"
 * )
 * // Returns: { valid: true }
 *
 * validateRequiredFields(
 *   { name: "John" },
 *   columns,
 *   "id"
 * )
 * // Returns: { valid: false, missingFields: ["email"] }
 */
export const validateRequiredFields = (
  data: Record<string, unknown>,
  columns: ColumnConfig[],
  primaryKeyColumn = "id"
): ValidationResult => {
  const missingFields: string[] = [];

  for (const column of columns) {
    // Skip primary key - it's not updated
    if (column.name === primaryKeyColumn) {
      continue;
    }

    // Skip nullable columns - they're not required
    if (column.nullable) {
      continue;
    }

    // Check if required field is present in data
    if (!(column.name in data)) {
      missingFields.push(column.name);
    }
  }

  if (missingFields.length > 0) {
    return { valid: false, missingFields };
  }

  return { valid: true };
};

/**
 * Filters the update data to only include valid columns and exclude primary key
 *
 * @param data - The raw update data
 * @param columns - Column metadata for validation
 * @param primaryKeyColumn - The primary key column name to exclude
 * @returns Filtered data with only valid, non-pk columns
 */
const filterUpdateData = (
  data: Record<string, unknown>,
  columns: ColumnConfig[],
  primaryKeyColumn = "id"
): Record<string, unknown> => {
  const columnNames = new Set(columns.map((c) => c.name));
  const filtered: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    // Skip primary key - never update it
    if (key === primaryKeyColumn) {
      continue;
    }

    // Only include valid column names
    if (columnNames.has(key)) {
      filtered[key] = value;
    }
  }

  return filtered;
};

/**
 * Applies RETURNING clause to an update query
 *
 * @param updateQuery - The Drizzle update query builder
 * @param table - The Drizzle PgTable instance
 * @param returning - Array of field names to return
 * @returns Promise resolving to query results
 */
const applyReturning = (
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder types are complex
  updateQuery: any,
  table: PgTable,
  returning?: string[]
): Promise<unknown[]> => {
  if (!returning) {
    return updateQuery.returning();
  }

  const returningColumns = buildReturningColumns(table, returning);
  if (Object.keys(returningColumns).length > 0) {
    return updateQuery.returning(returningColumns);
  }

  return updateQuery.returning();
};

/**
 * Executes an UPDATE query with the parsed parameters applied
 *
 * This is the main entry point for executing UPDATE operations.
 *
 * @param options - Update execution options
 * @param columns - Column metadata for filtering valid fields
 * @param primaryKeyColumn - The primary key column name (default: "id")
 * @returns Promise resolving to array of updated records
 *
 * @example
 * // Update with filters
 * const results = await executeUpdate({
 *   db: drizzleDb,
 *   table: usersTable,
 *   data: { is_active: true },
 *   params: { filters: [{ field: "is_active", operator: "eq", value: false }] }
 * }, columns);
 *
 * @example
 * // Update with returning
 * const results = await executeUpdate({
 *   db: drizzleDb,
 *   table: usersTable,
 *   data: { name: "Updated Name" },
 *   params: {
 *     filters: [{ field: "id", operator: "eq", value: 1 }],
 *     returning: ["id", "name"]
 *   }
 * }, columns);
 */
export const executeUpdate = (
  options: UpdateExecutionOptions,
  columns: ColumnConfig[],
  primaryKeyColumn = "id"
): Promise<unknown[]> => {
  const { db, table, data, params } = options;

  // Filter data to only valid columns, excluding primary key
  const filteredData = filterUpdateData(data, columns, primaryKeyColumn);

  // If no valid fields to update, return empty array
  if (Object.keys(filteredData).length === 0) {
    return Promise.resolve([]);
  }

  // Start building the update query
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder types are complex
  let updateQuery: any = db.update(table).set(filteredData);

  // Apply WHERE clause
  const whereClause = buildWhereClause(table, params.filters);
  if (whereClause) {
    updateQuery = updateQuery.where(whereClause);
  }

  // Apply RETURNING clause and execute
  return applyReturning(updateQuery, table, params.returning);
};

/**
 * Executes an UPDATE by primary key (for /:id endpoint)
 *
 * @param options - Update execution options with ID filter
 * @param id - The primary key value
 * @param columns - Column metadata for filtering valid fields
 * @param primaryKeyColumn - The primary key column name (default: "id")
 * @returns Promise resolving to array with single updated record or empty
 *
 * @example
 * const results = await executeUpdateById({
 *   db: drizzleDb,
 *   table: usersTable,
 *   data: { name: "New Name" },
 *   params: { returning: ["id", "name"] }
 * }, "123", columns, "id");
 */
export const executeUpdateById = (
  options: Omit<UpdateExecutionOptions, "params"> & {
    params: Omit<ParsedUpdateParams, "filters">;
  },
  id: string | number,
  columns: ColumnConfig[],
  primaryKeyColumn = "id"
): Promise<unknown[]> => {
  const { db, table, data, params } = options;

  const column = getColumn(table, primaryKeyColumn);
  if (!column) {
    throw new Error(`Primary key column ${primaryKeyColumn} not found`);
  }

  // Coerce ID to number if column type suggests it
  const idValue = typeof id === "string" ? Number(id) || id : id;

  // Create params with ID filter
  const updateParams: ParsedUpdateParams = {
    ...params,
    filters: [{ field: primaryKeyColumn, operator: "eq", value: idValue }],
  };

  return executeUpdate(
    {
      db,
      table,
      data,
      params: updateParams,
    },
    columns,
    primaryKeyColumn
  );
};
