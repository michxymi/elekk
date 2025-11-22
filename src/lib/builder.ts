import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { ZodTypeAny } from "zod";
import { z } from "zod";
import { PRIMARY_KEY_COLUMN } from "@/constants";
import type { ColumnConfig, RuntimeSchema } from "@/types";

// biome-ignore lint/suspicious/noExplicitAny: Runtime schema building requires dynamic column types
const DRIZZLE_MAP: Record<string, (name: string) => any> = {
  integer,
  text,
  "character varying": text,
  boolean,
  "timestamp without time zone": timestamp,
};

const ZOD_MAP: Record<string, ZodTypeAny> = {
  integer: z.number(),
  text: z.string(),
  boolean: z.boolean(),
  "timestamp without time zone": z.string(),
};

/**
 * Constructs runtime Drizzle table schema and Zod validation schema from column metadata
 *
 * @param tableName - Name of the database table
 * @param columns - Array of column configurations from database introspection
 * @returns Runtime schema containing Drizzle table definition and Zod validation schema
 */
export function buildRuntimeSchema(
  tableName: string,
  columns: ColumnConfig[]
): RuntimeSchema {
  // biome-ignore lint/suspicious/noExplicitAny: Runtime schema building requires dynamic column types
  const drizzleColumns: Record<string, any> = {};
  const zodShape: Record<string, ZodTypeAny> = {};

  for (const col of columns) {
    const builder = DRIZZLE_MAP[col.type] || text;
    let dCol = builder(col.name);
    if (col.name === PRIMARY_KEY_COLUMN) {
      dCol = dCol.primaryKey();
    }
    drizzleColumns[col.name] = dCol;

    let zVal = ZOD_MAP[col.type] || z.string();
    if (col.nullable) {
      zVal = zVal.nullable();
    }
    zodShape[col.name] = zVal;
  }

  return {
    table: pgTable(tableName, drizzleColumns),
    zodSchema: z.object(zodShape),
  };
}
