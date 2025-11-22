import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ColumnConfig } from "@/types";

/**
 * Fast schema drift detection using PostgreSQL transaction IDs (~1ms latency)
 *
 * Returns the xmin (transaction ID) of the table definition. If this value changes,
 * the table schema has been modified and cached routers should be invalidated.
 *
 * @param connectionString - PostgreSQL connection string
 * @param tableName - Name of the table to check
 * @returns Transaction ID as string, or null if table doesn't exist or error occurs
 */
export async function getTableVersion(
  connectionString: string,
  tableName: string
): Promise<string | null> {
  const client = postgres(connectionString);
  const db = drizzle(client);

  try {
    // We query pg_class to check the transaction ID of the table definition
    const result = await db.execute(sql`
      SELECT c.xmin::text as version_id
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = ${tableName} AND n.nspname = 'public'
    `);

    const versionId = result[0]?.version_id;
    return typeof versionId === "string" ? versionId : null;
  } catch (_error) {
    return null;
  } finally {
    await client.end();
  }
}

/**
 * Introspects column metadata for a single database table
 *
 * Queries information_schema to retrieve column names, data types, and nullability
 * information. Used for generating REST API endpoints.
 *
 * @param connectionString - PostgreSQL connection string
 * @param tableName - Name of the table to introspect
 * @returns Array of column configurations, or null if table doesn't exist or error occurs
 */
export async function getTableConfig(
  connectionString: string,
  tableName: string
): Promise<ColumnConfig[] | null> {
  const client = postgres(connectionString);
  const db = drizzle(client);

  try {
    const result = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tableName}
      ORDER BY ordinal_position;
    `);

    if (result.length === 0) {
      return null;
    }

    return result.map((row) => ({
      name: row.column_name as string,
      type: row.data_type as string,
      nullable: row.is_nullable === "YES",
    }));
  } catch (_error) {
    return null;
  } finally {
    await client.end();
  }
}

/**
 * Introspects all tables in the public schema
 *
 * Queries information_schema to retrieve column metadata for all tables in the database.
 * Returns a map of table names to their column configurations. Intended for future
 * GraphQL support where the entire schema needs to be known upfront.
 *
 * @param connectionString - PostgreSQL connection string
 * @returns Map of table names to arrays of column configurations
 */
export async function getEntireSchemaConfig(
  connectionString: string
): Promise<Record<string, ColumnConfig[]>> {
  const client = postgres(connectionString);
  const db = drizzle(client);

  try {
    const result = await db.execute(sql`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `);

    const tables: Record<string, ColumnConfig[]> = {};
    for (const row of result) {
      const tName = row.table_name as string;
      if (!tables[tName]) {
        tables[tName] = [];
      }
      tables[tName].push({
        name: row.column_name as string,
        type: row.data_type as string,
        nullable: row.is_nullable === "YES",
      });
    }

    return tables;
  } finally {
    await client.end();
  }
}
