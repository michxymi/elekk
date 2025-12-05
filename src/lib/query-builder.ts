import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  type SQL,
} from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type {
  FilterCondition,
  FilterOperator,
  ParsedQuery,
  SortDirective,
} from "./query-params";

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
 * Maps filter operators to their corresponding Drizzle ORM functions
 */
const OPERATOR_MAP: Record<
  FilterOperator,
  (column: PgColumn, value: unknown) => SQL
> = {
  eq: (col, val) => eq(col, val),
  gt: (col, val) => gt(col, val),
  gte: (col, val) => gte(col, val),
  lt: (col, val) => lt(col, val),
  lte: (col, val) => lte(col, val),
  like: (col, val) => like(col, String(val)),
  ilike: (col, val) => ilike(col, String(val)),
  in: (col, val) => inArray(col, val as unknown[]),
  isnull: (col, val) => (val ? isNull(col) : isNotNull(col)),
};

/**
 * Builds a single filter condition as a Drizzle SQL expression
 *
 * @param table - The Drizzle PgTable instance
 * @param filter - The filter condition to convert
 * @returns SQL expression or undefined if column not found
 *
 * @example
 * buildFilterCondition(usersTable, { field: "age", operator: "gte", value: 18 })
 * // Returns: SQL equivalent of "age >= 18"
 */
export const buildFilterCondition = (
  table: PgTable,
  filter: FilterCondition
): SQL | undefined => {
  const column = getColumn(table, filter.field);
  if (!column) {
    return;
  }

  const operatorFn = OPERATOR_MAP[filter.operator];
  if (!operatorFn) {
    return;
  }

  return operatorFn(column, filter.value);
};

/**
 * Builds all filter conditions combined with AND
 *
 * @param table - The Drizzle PgTable instance
 * @param filters - Array of filter conditions
 * @returns Combined SQL WHERE clause or undefined if no valid filters
 *
 * @example
 * buildWhereClause(usersTable, [
 *   { field: "age", operator: "gte", value: 18 },
 *   { field: "is_active", operator: "eq", value: true }
 * ])
 * // Returns: SQL equivalent of "age >= 18 AND is_active = true"
 */
export const buildWhereClause = (
  table: PgTable,
  filters: FilterCondition[]
): SQL | undefined => {
  if (filters.length === 0) {
    return;
  }

  const conditions = filters
    .map((filter) => buildFilterCondition(table, filter))
    .filter((condition): condition is SQL => condition !== undefined);

  if (conditions.length === 0) {
    return;
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return and(...conditions);
};

/**
 * Builds a single sort directive as a Drizzle order expression
 *
 * @param table - The Drizzle PgTable instance
 * @param directive - The sort directive
 * @returns Order expression or undefined if column not found
 *
 * @example
 * buildSortExpression(usersTable, { field: "created_at", direction: "desc" })
 * // Returns: desc(usersTable.created_at)
 */
export const buildSortExpression = (
  table: PgTable,
  directive: SortDirective
): SQL | undefined => {
  const column = getColumn(table, directive.field);
  if (!column) {
    return;
  }

  return directive.direction === "desc" ? desc(column) : asc(column);
};

/**
 * Builds all sort expressions as an array for orderBy
 *
 * @param table - The Drizzle PgTable instance
 * @param sortDirectives - Array of sort directives
 * @returns Array of order expressions
 *
 * @example
 * buildOrderByClause(usersTable, [
 *   { field: "name", direction: "asc" },
 *   { field: "created_at", direction: "desc" }
 * ])
 * // Returns: [asc(usersTable.name), desc(usersTable.created_at)]
 */
export const buildOrderByClause = (
  table: PgTable,
  sortDirectives: SortDirective[]
): SQL[] => {
  if (sortDirectives.length === 0) {
    return [];
  }

  return sortDirectives
    .map((directive) => buildSortExpression(table, directive))
    .filter((expr): expr is SQL => expr !== undefined);
};

/**
 * Builds a select column map for partial field selection
 *
 * @param table - The Drizzle PgTable instance
 * @param fields - Array of field names to select
 * @returns Record of field names to column references
 *
 * @example
 * buildSelectColumns(usersTable, ["id", "name", "email"])
 * // Returns: { id: usersTable.id, name: usersTable.name, email: usersTable.email }
 */
export const buildSelectColumns = (
  table: PgTable,
  fields: string[]
): Record<string, PgColumn> => {
  const selectMap: Record<string, PgColumn> = {};

  for (const field of fields) {
    const column = getColumn(table, field);
    if (column) {
      selectMap[field] = column;
    }
  }

  return selectMap;
};

/**
 * Query execution options for the executeQuery function
 */
export type QueryExecutionOptions = {
  /** The Drizzle database instance */
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db types are complex
  db: any;
  /** The Drizzle PgTable instance */
  table: PgTable;
  /** The parsed query parameters */
  query: ParsedQuery;
};

/**
 * Executes a query with all parsed parameters applied
 *
 * This is the main entry point for executing filtered, sorted, and paginated queries.
 * It applies WHERE, ORDER BY, LIMIT, OFFSET, and SELECT clauses based on the parsed query.
 *
 * @param options - Query execution options
 * @returns Promise resolving to query results
 *
 * @example
 * const results = await executeQuery({
 *   db: drizzleDb,
 *   table: usersTable,
 *   query: {
 *     filters: [{ field: "age", operator: "gte", value: 18 }],
 *     sort: [{ field: "name", direction: "asc" }],
 *     limit: 10,
 *     offset: 0,
 *     select: ["id", "name", "email"]
 *   }
 * });
 */
export const executeQuery = async (
  options: QueryExecutionOptions
): Promise<unknown[]> => {
  const { db, table, query } = options;

  // Build select columns or use full table
  const selectArg = query.select
    ? buildSelectColumns(table, query.select)
    : undefined;

  // Start building the query
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder types are complex
  let dbQuery: any = selectArg
    ? db.select(selectArg).from(table)
    : db.select().from(table);

  // Apply WHERE clause
  const whereClause = buildWhereClause(table, query.filters);
  if (whereClause) {
    dbQuery = dbQuery.where(whereClause);
  }

  // Apply ORDER BY clause
  const orderByClause = buildOrderByClause(table, query.sort);
  if (orderByClause.length > 0) {
    dbQuery = dbQuery.orderBy(...orderByClause);
  }

  // Apply LIMIT
  if (query.limit !== undefined) {
    dbQuery = dbQuery.limit(query.limit);
  }

  // Apply OFFSET
  if (query.offset !== undefined) {
    dbQuery = dbQuery.offset(query.offset);
  }

  return await dbQuery;
};
