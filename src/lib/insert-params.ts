import type { ColumnConfig } from "@/types";

/**
 * Supported on_conflict actions for INSERT operations
 */
export const ON_CONFLICT_ACTIONS = ["update", "nothing"] as const;

export type OnConflictAction = (typeof ON_CONFLICT_ACTIONS)[number];

/**
 * Configuration for ON CONFLICT behavior in INSERT operations
 */
export type OnConflictConfig = {
  /** The column to check for conflicts (e.g., email for UNIQUE constraint) */
  column: string;
  /** The action to take on conflict: 'update' or 'nothing' */
  action: OnConflictAction;
  /** Columns to update when action is 'update' (uses EXCLUDED values) */
  updateColumns?: string[];
};

/**
 * Fully parsed INSERT parameters ready for query building
 */
export type ParsedInsertParams = {
  /** Fields to return after INSERT (RETURNING clause) */
  returning?: string[];
  /** ON CONFLICT configuration for upsert behavior */
  onConflict?: OnConflictConfig;
};

/**
 * Reserved query parameter names for INSERT operations
 */
export const INSERT_RESERVED_PARAMS = [
  "returning",
  "on_conflict",
  "on_conflict_action",
  "on_conflict_update",
];

/**
 * Parses the returning query parameter into an array of field names
 *
 * @param value - The returning parameter value (e.g., "id,name,email")
 * @returns Array of field names to return after INSERT
 *
 * @example
 * parseReturningParam("id,name,email") // ["id", "name", "email"]
 * parseReturningParam("id") // ["id"]
 * parseReturningParam("  id , name  ") // ["id", "name"]
 */
export const parseReturningParam = (value: string): string[] => {
  if (!value.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};

/**
 * Parses the on_conflict_update parameter into an array of column names
 *
 * @param value - The on_conflict_update parameter value (e.g., "name,updated_at")
 * @returns Array of column names to update on conflict
 *
 * @example
 * parseOnConflictUpdateParam("name,updated_at") // ["name", "updated_at"]
 * parseOnConflictUpdateParam("name") // ["name"]
 */
export const parseOnConflictUpdateParam = (value: string): string[] => {
  if (!value.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};

/**
 * Parses ON CONFLICT related query parameters into a configuration object
 *
 * @param params - Record of query parameter key-value pairs
 * @param columnMap - Map of valid column names for validation
 * @returns OnConflictConfig if valid on_conflict param provided, undefined otherwise
 *
 * @example
 * // DO NOTHING on email conflict
 * parseOnConflictParams({ on_conflict: "email", on_conflict_action: "nothing" }, columnMap)
 * // { column: "email", action: "nothing" }
 *
 * @example
 * // DO UPDATE on email conflict
 * parseOnConflictParams({ on_conflict: "email", on_conflict_update: "name,updated_at" }, columnMap)
 * // { column: "email", action: "update", updateColumns: ["name", "updated_at"] }
 */
export const parseOnConflictParams = (
  params: Record<string, string>,
  columnMap: Map<string, ColumnConfig>
): OnConflictConfig | undefined => {
  const conflictColumn = params.on_conflict?.trim();

  // No on_conflict specified
  if (!conflictColumn) {
    return;
  }

  // Validate conflict column exists
  if (!columnMap.has(conflictColumn)) {
    return;
  }

  // Determine action - default to 'update' if on_conflict_update is provided
  const actionParam = params.on_conflict_action?.trim().toLowerCase();
  const updateParam = params.on_conflict_update?.trim();

  // If on_conflict_action=nothing, use DO NOTHING
  if (actionParam === "nothing") {
    return {
      column: conflictColumn,
      action: "nothing",
    };
  }

  // If on_conflict_update is provided, use DO UPDATE
  if (updateParam) {
    const updateColumns = parseOnConflictUpdateParam(updateParam);
    // Filter to only valid columns
    const validUpdateColumns = updateColumns.filter((col) =>
      columnMap.has(col)
    );

    if (validUpdateColumns.length === 0) {
      // No valid columns to update, fall back to nothing
      return {
        column: conflictColumn,
        action: "nothing",
      };
    }

    return {
      column: conflictColumn,
      action: "update",
      updateColumns: validUpdateColumns,
    };
  }

  // on_conflict without action or update columns defaults to nothing
  return {
    column: conflictColumn,
    action: "nothing",
  };
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
 * Parses all INSERT query parameters into a structured ParsedInsertParams object
 *
 * @param params - Record of query parameter key-value pairs
 * @param columns - Column metadata for validation
 * @returns Fully parsed INSERT parameters with returning and onConflict configuration
 *
 * @example
 * parseInsertParams(
 *   { returning: "id,name", on_conflict: "email", on_conflict_action: "nothing" },
 *   [{ name: "id", type: "integer", nullable: false }, ...]
 * )
 * // Returns: {
 * //   returning: ["id", "name"],
 * //   onConflict: { column: "email", action: "nothing" }
 * // }
 *
 * @example
 * parseInsertParams(
 *   { returning: "id", on_conflict: "email", on_conflict_update: "name,updated_at" },
 *   columns
 * )
 * // Returns: {
 * //   returning: ["id"],
 * //   onConflict: { column: "email", action: "update", updateColumns: ["name", "updated_at"] }
 * // }
 */
export const parseInsertParams = (
  params: Record<string, string>,
  columns: ColumnConfig[]
): ParsedInsertParams => {
  const columnMap = new Map(columns.map((col) => [col.name, col]));

  return {
    returning: parseReturning(params.returning, columnMap),
    onConflict: parseOnConflictParams(params, columnMap),
  };
};

/**
 * Checks if a ParsedInsertParams has any active parameters
 *
 * @param params - The parsed insert params object
 * @returns true if the params have returning or onConflict configuration
 *
 * @example
 * hasInsertParams({ returning: ["id"] }) // true
 * hasInsertParams({ onConflict: { column: "email", action: "nothing" } }) // true
 * hasInsertParams({}) // false
 */
export const hasInsertParams = (params: ParsedInsertParams): boolean =>
  params.returning !== undefined || params.onConflict !== undefined;
