import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod";

const DRIZZLE_MAP: Record<string, any> = {
  integer,
  text,
  "character varying": text,
  boolean,
  "timestamp without time zone": timestamp,
};

const ZOD_MAP: Record<string, any> = {
  integer: z.number(),
  text: z.string(),
  boolean: z.boolean(),
  "timestamp without time zone": z.string(),
};

export function buildRuntimeSchema(tableName: string, columns: any[]) {
  const drizzleColumns: Record<string, any> = {};
  const zodShape: Record<string, any> = {};

  columns.forEach((col) => {
    const builder = DRIZZLE_MAP[col.type] || text;
    let dCol = builder(col.name);
    if (col.name === "id") dCol = dCol.primaryKey();
    drizzleColumns[col.name] = dCol;

    let zVal = ZOD_MAP[col.type] || z.string();
    if (col.nullable) zVal = zVal.nullable();
    zodShape[col.name] = zVal;
  });

  return {
    table: pgTable(tableName, drizzleColumns),
    zodSchema: z.object(zodShape),
  };
}
