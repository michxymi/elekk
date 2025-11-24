import type { ColumnConfig } from "@/types";

/**
 * Supported filter operators for SQL-like query parameters
 */
export const FILTER_OPERATORS = [
  "eq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "in",
  "isnull",
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/**
 * Reserved query parameter names that are not column filters
 */
export const RESERVED_PARAMS = ["order_by", "limit", "offset", "select"];

/**
 * A single filter condition parsed from query parameters
 */
export type FilterCondition = {
  field: string;
  operator: FilterOperator;
  value: unknown;
};

/**
 * A sort directive parsed from order_by parameter
 */
export type SortDirective = {
  field: string;
  direction: "asc" | "desc";
};

/**
 * Fully parsed query parameters ready for query building
 */
export type ParsedQuery = {
  filters: FilterCondition[];
  sort: SortDirective[];
  limit?: number;
  offset?: number;
  select?: string[];
};

/**
 * Type mapping from PostgreSQL types to value coercion functions
 */
const TYPE_COERCERS: Record<string, (value: string) => unknown> = {
  integer: (v) => {
    const num = Number(v);
    return Number.isNaN(num) ? v : num;
  },
  boolean: (v) => v === "true" || v === "1",
  "timestamp without time zone": (v) => v,
  text: (v) => v,
  "character varying": (v) => v,
};

/**
 * Parses a single query parameter key to extract field name and operator
 *
 * @param key - The query parameter key (e.g., "age__gt", "name", "email__ilike")
 * @returns Object with field name and operator, or null if invalid
 *
 * @example
 * parseFilterKey("age__gt") // { field: "age", operator: "gt" }
 * parseFilterKey("name") // { field: "name", operator: "eq" }
 * parseFilterKey("order_by") // null (reserved param)
 */
export const parseFilterKey = (
  key: string
): { field: string; operator: FilterOperator } | null => {
  if (RESERVED_PARAMS.includes(key)) {
    return null;
  }

  const parts = key.split("__");
  const field = parts[0];

  if (!field) {
    return null;
  }

  if (parts.length === 1) {
    return { field, operator: "eq" };
  }

  const operatorStr = parts[1];
  if (operatorStr && FILTER_OPERATORS.includes(operatorStr as FilterOperator)) {
    return { field, operator: operatorStr as FilterOperator };
  }

  // Unknown operator, treat entire key as field with eq operator
  return { field: key, operator: "eq" };
};

/**
 * Coerces a string value to the appropriate type based on column metadata
 *
 * @param value - The string value from query parameter
 * @param columnType - The PostgreSQL column type
 * @param operator - The filter operator being used
 * @returns Coerced value appropriate for the operator and column type
 *
 * @example
 * coerceValue("25", "integer", "gt") // 25
 * coerceValue("true", "boolean", "eq") // true
 * coerceValue("1,2,3", "integer", "in") // [1, 2, 3]
 */
export const coerceValue = (
  value: string,
  columnType: string,
  operator: FilterOperator
): unknown => {
  // Handle isnull operator specially
  if (operator === "isnull") {
    return value === "true" || value === "1";
  }

  // Handle IN operator - split by comma and coerce each value
  if (operator === "in") {
    const values = value.split(",").map((v) => v.trim());
    const coercer = TYPE_COERCERS[columnType] ?? TYPE_COERCERS.text;
    return values.map((v) => coercer(v));
  }

  // Regular value coercion
  const coercer = TYPE_COERCERS[columnType] ?? TYPE_COERCERS.text;
  return coercer(value);
};

/**
 * Parses the order_by query parameter into sort directives
 *
 * @param orderBy - The order_by parameter value (e.g., "name,-created_at")
 * @returns Array of sort directives
 *
 * @example
 * parseSortParam("name") // [{ field: "name", direction: "asc" }]
 * parseSortParam("-created_at") // [{ field: "created_at", direction: "desc" }]
 * parseSortParam("name,-age") // [{ field: "name", direction: "asc" }, { field: "age", direction: "desc" }]
 */
export const parseSortParam = (orderBy: string): SortDirective[] => {
  if (!orderBy.trim()) {
    return [];
  }

  return orderBy
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("-")) {
        return { field: part.slice(1), direction: "desc" as const };
      }
      return { field: part, direction: "asc" as const };
    });
};

/**
 * Parses the select query parameter into an array of field names
 *
 * @param select - The select parameter value (e.g., "id,name,email")
 * @returns Array of field names to select
 *
 * @example
 * parseSelectParam("id,name,email") // ["id", "name", "email"]
 * parseSelectParam("id") // ["id"]
 */
export const parseSelectParam = (select: string): string[] => {
  if (!select.trim()) {
    return [];
  }

  return select
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};

/**
 * Extracts filter conditions from query parameters
 */
const extractFilters = (
  params: Record<string, string>,
  columnMap: Map<string, ColumnConfig>
): FilterCondition[] => {
  const filters: FilterCondition[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
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
 * Parses limit parameter, returns undefined if invalid
 */
const parseLimit = (value: string | undefined): number | undefined => {
  if (!value) {
    return;
  }
  const limit = Number.parseInt(value, 10);
  if (Number.isNaN(limit) || limit <= 0) {
    return;
  }
  return limit;
};

/**
 * Parses offset parameter, returns undefined if invalid
 */
const parseOffset = (value: string | undefined): number | undefined => {
  if (!value) {
    return;
  }
  const offset = Number.parseInt(value, 10);
  if (Number.isNaN(offset) || offset < 0) {
    return;
  }
  return offset;
};

/**
 * Parses select parameter and validates fields exist in table
 */
const parseSelect = (
  value: string | undefined,
  columnMap: Map<string, ColumnConfig>
): string[] | undefined => {
  if (!value) {
    return;
  }
  const selectFields = parseSelectParam(value);
  const validFields = selectFields.filter((f) => columnMap.has(f));
  if (validFields.length === 0) {
    return;
  }
  return validFields;
};

/**
 * Parses all query parameters into a structured ParsedQuery object
 *
 * @param params - Record of query parameter key-value pairs
 * @param columns - Column metadata for type coercion
 * @returns Fully parsed query with filters, sort, pagination, and field selection
 *
 * @example
 * parseQueryParams(
 *   { name: "John", age__gte: "18", order_by: "-created_at", limit: "10" },
 *   [{ name: "name", type: "text", nullable: false }, { name: "age", type: "integer", nullable: true }]
 * )
 * // Returns: {
 * //   filters: [
 * //     { field: "name", operator: "eq", value: "John" },
 * //     { field: "age", operator: "gte", value: 18 }
 * //   ],
 * //   sort: [{ field: "created_at", direction: "desc" }],
 * //   limit: 10,
 * //   offset: undefined,
 * //   select: undefined
 * // }
 */
export const parseQueryParams = (
  params: Record<string, string>,
  columns: ColumnConfig[]
): ParsedQuery => {
  const columnMap = new Map(columns.map((col) => [col.name, col]));

  return {
    filters: extractFilters(params, columnMap),
    sort: params.order_by ? parseSortParam(params.order_by) : [],
    limit: parseLimit(params.limit),
    offset: parseOffset(params.offset),
    select: parseSelect(params.select, columnMap),
  };
};

/**
 * Checks if a ParsedQuery has any active query parameters
 *
 * @param query - The parsed query object
 * @returns true if the query has any filters, sorting, pagination, or field selection
 *
 * @example
 * hasQueryParams({ filters: [], sort: [] }) // false
 * hasQueryParams({ filters: [{ field: "name", operator: "eq", value: "John" }], sort: [] }) // true
 */
export const hasQueryParams = (query: ParsedQuery): boolean =>
  query.filters.length > 0 ||
  query.sort.length > 0 ||
  query.limit !== undefined ||
  query.offset !== undefined ||
  query.select !== undefined;

/**
 * Generates a deterministic cache key from parsed query parameters
 *
 * The key is generated by sorting and serializing all query components
 * to ensure the same query always produces the same cache key.
 *
 * @param tableName - The database table name
 * @param query - The parsed query object
 * @returns A deterministic cache key string
 *
 * @example
 * generateQueryCacheKey("users", { filters: [{ field: "name", operator: "eq", value: "John" }], sort: [] })
 * // Returns: "data:users:query:f[name:eq:John]"
 */
export const generateQueryCacheKey = (
  tableName: string,
  query: ParsedQuery
): string => {
  const parts: string[] = [];

  // Sort filters by field name for deterministic ordering
  if (query.filters.length > 0) {
    const sortedFilters = [...query.filters].sort((a, b) =>
      a.field.localeCompare(b.field)
    );
    const filterStr = sortedFilters
      .map((f) => {
        const valueStr = Array.isArray(f.value)
          ? f.value.join("|")
          : String(f.value);
        return `${f.field}:${f.operator}:${valueStr}`;
      })
      .join(",");
    parts.push(`f[${filterStr}]`);
  }

  // Sort directives
  if (query.sort.length > 0) {
    const sortStr = query.sort
      .map((s) => `${s.direction === "desc" ? "-" : ""}${s.field}`)
      .join(",");
    parts.push(`s[${sortStr}]`);
  }

  // Pagination
  if (query.limit !== undefined) {
    parts.push(`l${query.limit}`);
  }
  if (query.offset !== undefined) {
    parts.push(`o${query.offset}`);
  }

  // Field selection
  if (query.select) {
    const selectStr = [...query.select].sort().join(",");
    parts.push(`c[${selectStr}]`);
  }

  if (parts.length === 0) {
    return `data:${tableName}:list`;
  }

  return `data:${tableName}:query:${parts.join(";")}`;
};
