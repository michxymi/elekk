import type { ColumnConfig } from "@/types";
import { parseReturningParam } from "./insert-params";
import {
  coerceValue,
  type FilterCondition,
  parseFilterKey,
  RESERVED_PARAMS,
} from "./query-params";

export type { FilterCondition, FilterOperator } from "./query-params";

/**
 * Reserved query parameter names for UPDATE operations
 */
export const UPDATE_RESERVED_PARAMS = ["returning"];

/**
 * Fully parsed UPDATE parameters ready for query building
 */
export type ParsedUpdateParams = {
  /** Filters for WHERE clause (which rows to update) */
  filters: FilterCondition[];
  /** Fields to return after UPDATE (RETURNING clause) */
  returning?: string[];
};

/**
 * Extracts filter conditions from query parameters for UPDATE
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
  const allReserved = [...RESERVED_PARAMS, ...UPDATE_RESERVED_PARAMS];

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
 * Parses all UPDATE query parameters into a structured ParsedUpdateParams object
 *
 * @param params - Record of query parameter key-value pairs
 * @param columns - Column metadata for validation
 * @returns Fully parsed UPDATE parameters with filters and returning configuration
 *
 * @example
 * parseUpdateParams(
 *   { id: "1", returning: "id,name" },
 *   [{ name: "id", type: "integer", nullable: false }, ...]
 * )
 * // Returns: {
 * //   filters: [{ field: "id", operator: "eq", value: 1 }],
 * //   returning: ["id", "name"]
 * // }
 *
 * @example
 * parseUpdateParams(
 *   { is_active: "false", returning: "id,email" },
 *   columns
 * )
 * // Returns: {
 * //   filters: [{ field: "is_active", operator: "eq", value: false }],
 * //   returning: ["id", "email"]
 * // }
 */
export const parseUpdateParams = (
  params: Record<string, string>,
  columns: ColumnConfig[]
): ParsedUpdateParams => {
  const columnMap = new Map(columns.map((col) => [col.name, col]));

  const result: ParsedUpdateParams = {
    filters: extractFilters(params, columnMap),
  };

  const returning = parseReturning(params.returning, columnMap);
  if (returning) {
    result.returning = returning;
  }

  return result;
};

/**
 * Checks if a ParsedUpdateParams has any active parameters
 *
 * @param params - The parsed update params object
 * @returns true if the params have filters or returning configuration
 *
 * @example
 * hasUpdateParams({ filters: [] }) // false
 * hasUpdateParams({ filters: [{ field: "id", operator: "eq", value: 1 }] }) // true
 * hasUpdateParams({ filters: [], returning: ["id"] }) // true
 */
export const hasUpdateParams = (params: ParsedUpdateParams): boolean =>
  params.filters.length > 0 || params.returning !== undefined;
