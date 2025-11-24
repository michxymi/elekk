import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/postgres-js";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import postgres from "postgres";
import { PRIMARY_KEY_COLUMN } from "@/constants";
import {
  deleteCachedKey,
  getListCacheKey,
  readCachedQueryResult,
  writeCachedQueryResult,
} from "@/lib/data-cache";
import type { Env as AppEnv } from "@/types";

type CrudRouterOptions = {
  env?: AppEnv;
  schemaVersion?: string;
};

type RuntimeTable = unknown;

type CritRevalidationOptions = {
  kv: KVNamespace;
  table: RuntimeTable;
  connectionString: string;
  cacheKey: string;
  schemaVersion: string;
};

const revalidateListCache = async (options: CritRevalidationOptions) => {
  const client = postgres(options.connectionString);
  const db = drizzle(client);
  try {
    const results = await db.select().from(options.table as never);
    await writeCachedQueryResult(options.kv, options.cacheKey, {
      data: results,
      cachedAt: Date.now(),
      version: options.schemaVersion,
    });
  } catch (error) {
    console.error("List cache revalidation failed", error);
  }
};

type ListRevalidationParams = {
  env?: AppEnv;
  connectionString: string;
  table: RuntimeTable;
  cacheKey: string;
  schemaVersion?: string;
};

type ExecutionContextHolder = {
  executionCtx?: {
    waitUntil: (promise: Promise<unknown>) => void;
  };
};

const scheduleListCacheRevalidation = (
  c: ExecutionContextHolder,
  params: ListRevalidationParams
) => {
  if (!(params.env?.DATA_CACHE && params.schemaVersion)) {
    return;
  }

  try {
    const waitUntil = c.executionCtx?.waitUntil;
    if (!waitUntil) {
      return;
    }

    waitUntil(
      revalidateListCache({
        kv: params.env.DATA_CACHE,
        table: params.table,
        connectionString: params.connectionString,
        cacheKey: params.cacheKey,
        schemaVersion: params.schemaVersion,
      })
    );
  } catch (error) {
    console.error("Failed to schedule list cache revalidation", error);
  }
};
/**
 * Generates an OpenAPI-compliant CRUD router for a database table
 *
 * @param tableName - Name of the database table
 * @param table - Runtime-generated Drizzle table schema
 * @param connectionString - PostgreSQL connection string
 * @param options - Optional cache bindings
 * @returns OpenAPIHono router with CRUD endpoints
 */
export function createCrudRouter(
  tableName: string,
  table: RuntimeTable,
  connectionString: string,
  options: CrudRouterOptions = {}
): OpenAPIHono {
  const app = new OpenAPIHono();

  const selectSchema = createSelectSchema(
    table as never
  ) as unknown as z.ZodTypeAny;
  const baseInsertSchema = createInsertSchema(table as never);
  const insertSchema = baseInsertSchema.omit({
    [PRIMARY_KEY_COLUMN]: true,
  }) as unknown as z.ZodTypeAny;

  const cacheKey = getListCacheKey(tableName);
  const cacheKv = options.env?.DATA_CACHE;
  const schemaVersion = options.schemaVersion;
  const cacheEnabled = Boolean(cacheKv && schemaVersion);

  // GET / (List)
  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: [tableName],
      responses: {
        200: {
          content: { "application/json": { schema: z.array(selectSchema) } },
          description: "List",
        },
      },
    }),
    async (c) => {
      const cacheControl = c.req.header("X-Cache-Control");
      const shouldBypassCache = cacheControl === "no-cache";

      if (!shouldBypassCache && cacheEnabled && cacheKv && schemaVersion) {
        const cached = await readCachedQueryResult(cacheKv, cacheKey);
        if (cached?.version === schemaVersion) {
          scheduleListCacheRevalidation(c, {
            env: options.env,
            connectionString,
            table,
            cacheKey,
            schemaVersion,
          });
          return c.json(cached.data);
        }
      }

      const client = postgres(connectionString);
      const db = drizzle(client);
      const results = await db.select().from(table as never);

      if (cacheEnabled && cacheKv && schemaVersion) {
        await writeCachedQueryResult(cacheKv, cacheKey, {
          data: results,
          cachedAt: Date.now(),
          version: schemaVersion,
        });
      }

      return c.json(results);
    }
  );

  // POST / (Create)
  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: [tableName],
      request: {
        body: { content: { "application/json": { schema: insertSchema } } },
      },
      responses: { 201: { description: "Created" } },
    }),
    async (c) => {
      const client = postgres(connectionString);
      const db = drizzle(client);
      const body = await c.req.json();
      const result = (await db
        .insert(table as never)
        .values(body)
        .returning()) as unknown[];
      if (result.length === 0) {
        return c.json({ error: "Insert failed" }, 500);
      }

      if (options.env?.DATA_CACHE) {
        await deleteCachedKey(options.env.DATA_CACHE, cacheKey);
      }

      return c.json(result[0], 201);
    }
  );

  return app;
}
