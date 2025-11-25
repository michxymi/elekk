import type { ColumnConfig } from "@/types";
import { parseReturningParam } from "./insert-params";
import { coerceValue, parseFilterKey, RESERVED_PARAMS } from "./query-params";

export type { FilterCondition, FilterOperator } from "./query-params";

/**
 * Columns that indicate soft delete support in a table
 */
export const SOFT_DELETE_COLUMNS = ["deleted_at", "is_deleted"] as const;

/**
 * Reserved query parameter names for DELETE operations
 */
export const DELETE_RESERVED_PARAMS = ["returning", "hard_delete"];

/**
 * Fully parsed DELETE parameters ready for query building
 */
export type ParsedDeleteParams = {
  /** Filters for WHERE clause (which rows to delete) */
  filters: FilterCondition[];
  /** Fields to return after DELETE (RETURNING clause) */
  returning?: string[];
  /** Force hard delete even if table has soft delete column */
  hardDelete?: boolean;
};

/**
 * Detects if a table has a soft delete column
 *
 * @param columns - Column metadata for the table
 * @returns The soft delete column name if found, undefined otherwise
 *
 * @example
 * detectSoftDeleteColumn([{ name: "deleted_at", type: "timestamp without time zone", nullable: true }])
 * // Returns: "deleted_at"
 *
 * detectSoftDeleteColumn([{ name: "id", type: "integer", nullable: false }])
 * // Returns: undefined
 */
export const detectSoftDeleteColumn = (
  columns: ColumnConfig[]
): string | undefined => {
  for (const column of columns) {
    if (
      SOFT_DELETE_COLUMNS.includes(
        column.name as (typeof SOFT_DELETE_COLUMNS)[number]
      )
    ) {
      return column.name;
    }
  }
  return;
};

/**
 * Extracts filter conditions from query parameters for DELETE
 *
 * @param params - Record of query parameter key-value pairs
 * @param columnMap - Map of valid column names
 * @returns Array of filter conditions
 */
const extractFilters = (
  params: Record<string, string>,
  columnMap: Map<string, ColumnConfig>
): FilterCondition[] => {
  const filters: FilterCondition[] = [];
  const allReserved = [...RESERVED_PARAMS, ...DELETE_RESERVED_PARAMS];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue;
    }

    // Skip reserved params
    if (allReserved.includes(key)) {
      continue;
    }

    const parsed = parseFilterKey(key);
    if (!parsed) {
      continue;
    }

    const column = columnMap.get(parsed.field);
    if (!column) {
      continue;
    }

    filters.push({
      field: parsed.field,
      operator: parsed.operator,
      value: coerceValue(value, column.type, parsed.operator),
    });
  }

  return filters;
};

/**
 * Parses returning parameter and validates fields exist in table
 *
 * @param value - The returning parameter value
 * @param columnMap - Map of valid column names for validation
 * @returns Array of valid field names or undefined if none valid
 */
const parseReturning = (
  value: string | undefined,
  columnMap: Map<string, ColumnConfig>
): string[] | undefined => {
  if (!value) {
    return;
  }

  const fields = parseReturningParam(value);
  const validFields = fields.filter((f) => columnMap.has(f));

  if (validFields.length === 0) {
    return;
  }

  return validFields;
};

/**
 * Parses the hard_delete query parameter
 *
 * @param value - The hard_delete parameter value
 * @returns true if hard delete is requested
 */
const parseHardDelete = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  return value === "true" || value === "1";
};

/**
 * Parses all DELETE query parameters into a structured ParsedDeleteParams object
 *
 * @param params - Record of query parameter key-value pairs
 * @param columns - Column metadata for validation
 * @returns Fully parsed DELETE parameters with filters and returning configuration
 *
 * @example
 * parseDeleteParams(
 *   { id: "1", returning: "id,name" },
 *   [{ name: "id", type: "integer", nullable: false }, ...]
 * )
 * // Returns: {
 * //   filters: [{ field: "id", operator: "eq", value: 1 }],
 * //   returning: ["id", "name"]
 * // }
 *
 * @example
 * parseDeleteParams(
 *   { is_active: "false", hard_delete: "true" },
 *   columns
 * )
 * // Returns: {
 * //   filters: [{ field: "is_active", operator: "eq", value: false }],
 * //   hardDelete: true
 * // }
 */
export const parseDeleteParams = (
  params: Record<string, string>,
  columns: ColumnConfig[]
): ParsedDeleteParams => {
  const columnMap = new Map(columns.map((col) => [col.name, col]));

  const result: ParsedDeleteParams = {
    filters: extractFilters(params, columnMap),
  };

  const returning = parseReturning(params.returning, columnMap);
  if (returning) {
    result.returning = returning;
  }

  const hardDelete = parseHardDelete(params.hard_delete);
  if (hardDelete) {
    result.hardDelete = hardDelete;
  }

  return result;
};

/**
 * Checks if a ParsedDeleteParams has any active parameters
 *
 * @param params - The parsed delete params object
 * @returns true if the params have filters, returning, or hardDelete configuration
 *
 * @example
 * hasDeleteParams({ filters: [] }) // false
 * hasDeleteParams({ filters: [{ field: "id", operator: "eq", value: 1 }] }) // true
 * hasDeleteParams({ filters: [], returning: ["id"] }) // true
 * hasDeleteParams({ filters: [], hardDelete: true }) // true
 */
export const hasDeleteParams = (params: ParsedDeleteParams): boolean =>
  params.filters.length > 0 ||
  params.returning !== undefined ||
  params.hardDelete === true;
