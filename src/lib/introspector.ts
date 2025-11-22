import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// 1. Schema Drift Detector (~1ms latency)
// Returns the Transaction ID (xmin). If this changes, the schema changed.
export async function getTableVersion(
  connectionString: string,
  tableName = "users"
) {
  const client = postgres(connectionString);
  const db = drizzle(client);

  // We query pg_class to check the transaction ID of the table definition
  const result = await db.execute(sql`
    SELECT xmin::text as version_id
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = ${tableName} AND n.nspname = 'public'
  `);

  return result[0]?.version_id || null;
}

// 2. Single Table Introspection (For REST)
export async function getTableConfig(
  connectionString: string,
  tableName: string
) {
  const client = postgres(connectionString);
  const db = drizzle(client);

  const result = await db.execute(sql`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = ${tableName}
    ORDER BY ordinal_position;
  `);

  if (result.length === 0) return null;

  return result.map((row) => ({
    name: row.column_name as string,
    type: row.data_type as string,
    nullable: row.is_nullable === "YES",
  }));
}

// 3. Full DB Introspection (For GraphQL)
export async function getEntireSchemaConfig(connectionString: string) {
  const client = postgres(connectionString);
  const db = drizzle(client);

  const result = await db.execute(sql`
    SELECT table_name, column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `);

  const tables: Record<string, any[]> = {};
  result.forEach((row) => {
    const tName = row.table_name as string;
    if (!tables[tName]) tables[tName] = [];
    tables[tName].push({
      name: row.column_name as string,
      type: row.data_type as string,
      nullable: row.is_nullable === "YES",
    });
  });

  return tables;
}
