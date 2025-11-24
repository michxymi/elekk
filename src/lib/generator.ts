import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { PgTable } from "drizzle-orm/pg-core";
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
import { executeQuery } from "@/lib/query-builder";
import {
  type FilterOperator,
  generateQueryCacheKey,
  hasQueryParams,
  type ParsedQuery,
  parseQueryParams,
} from "@/lib/query-params";
import type { Env as AppEnv, ColumnConfig } from "@/types";

type CrudRouterOptions = {
  env?: AppEnv;
  schemaVersion?: string;
  columns?: ColumnConfig[];
};

type RuntimeTable = unknown;

type CritRevalidationOptions = {
  kv: KVNamespace;
  table: RuntimeTable;
  connectionString: string;
  cacheKey: string;
  schemaVersion: string;
  query?: ParsedQuery;
  columns?: ColumnConfig[];
};

/**
 * Revalidates the list cache by fetching fresh data from the database
 *
 * @param options - Revalidation options including KV store, table, and query params
 */
const revalidateListCache = async (options: CritRevalidationOptions) => {
  const client = postgres(options.connectionString);
  const db = drizzle(client);
  try {
    let results: unknown[];

    if (options.query && hasQueryParams(options.query)) {
      results = await executeQuery({
        db,
        table: options.table as PgTable,
        query: options.query,
      });
    } else {
      results = await db.select().from(options.table as never);
    }

    await writeCachedQueryResult(options.kv, options.cacheKey, {
      data: results,
      cachedAt: Date.now(),
      version: options.schemaVersion,
      query: options.query,
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
  query?: ParsedQuery;
  columns?: ColumnConfig[];
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
        query: params.query,
        columns: params.columns,
      })
    );
  } catch (error) {
    console.error("Failed to schedule list cache revalidation", error);
  }
};

const COMPARABLE_TYPES = [
  "integer",
  "timestamp without time zone",
  "numeric",
  "real",
  "double precision",
];

const TEXT_TYPES = ["text", "character varying", "varchar"];

/**
 * Adds filter parameters for a single column to the schema shape
 */
const addColumnFilters = (
  shape: Record<string, z.ZodTypeAny>,
  column: ColumnConfig
): void => {
  const { name, type, nullable } = column;

  // Base equality filter
  shape[name] = z
    .string()
    .optional()
    .openapi({
      param: { name, in: "query" },
      description: `Filter by ${name} (equals)`,
      example: type === "integer" ? "1" : "value",
    });

  // Comparison operators for numeric/date types
  if (COMPARABLE_TYPES.includes(type)) {
    for (const op of ["gt", "gte", "lt", "lte"] as const) {
      const paramName = `${name}__${op}`;
      shape[paramName] = z
        .string()
        .optional()
        .openapi({
          param: { name: paramName, in: "query" },
          description: `Filter by ${name} (${getOperatorDescription(op)})`,
          example: type === "integer" ? "10" : "2024-01-01",
        });
    }
  }

  // String operators for text types
  if (TEXT_TYPES.includes(type)) {
    const likeParam = `${name}__like`;
    shape[likeParam] = z
      .string()
      .optional()
      .openapi({
        param: { name: likeParam, in: "query" },
        description: `Filter by ${name} (LIKE pattern, case-sensitive)`,
        example: "%pattern%",
      });

    const ilikeParam = `${name}__ilike`;
    shape[ilikeParam] = z
      .string()
      .optional()
      .openapi({
        param: { name: ilikeParam, in: "query" },
        description: `Filter by ${name} (ILIKE pattern, case-insensitive)`,
        example: "%pattern%",
      });
  }

  // IN operator for all types
  const inParam = `${name}__in`;
  shape[inParam] = z
    .string()
    .optional()
    .openapi({
      param: { name: inParam, in: "query" },
      description: `Filter by ${name} (IN list, comma-separated)`,
      example: "value1,value2,value3",
    });

  // IS NULL operator for nullable columns
  if (nullable) {
    const isnullParam = `${name}__isnull`;
    shape[isnullParam] = z
      .string()
      .optional()
      .openapi({
        param: { name: isnullParam, in: "query" },
        description: `Filter by ${name} (IS NULL when true, IS NOT NULL when false)`,
        example: "true",
      });
  }
};

/**
 * Adds global query parameters (order_by, limit, offset, select) to the schema shape
 */
const addGlobalParams = (
  shape: Record<string, z.ZodTypeAny>,
  columns: ColumnConfig[]
): void => {
  shape.order_by = z
    .string()
    .optional()
    .openapi({
      param: { name: "order_by", in: "query" },
      description:
        "Sort results by field(s). Prefix with - for descending. Comma-separate for multiple.",
      example: "-created_at,name",
    });

  shape.limit = z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .openapi({
      param: { name: "limit", in: "query" },
      description: "Maximum number of records to return",
      example: 10,
    });

  shape.offset = z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .openapi({
      param: { name: "offset", in: "query" },
      description: "Number of records to skip for pagination",
      example: 0,
    });

  const columnNames = columns.map((c) => c.name).join(",");
  shape.select = z
    .string()
    .optional()
    .openapi({
      param: { name: "select", in: "query" },
      description: "Comma-separated list of fields to return",
      example: columnNames.slice(0, 50),
    });
};

/**
 * Generates a Zod schema for query parameters based on column metadata
 *
 * Creates fully-typed query parameter schemas where each column gets parameters
 * for all supported filter operators (eq, gt, gte, lt, lte, like, ilike, in, isnull).
 *
 * @param columns - Array of column configurations from database introspection
 * @returns Zod schema for query parameters
 */
const buildQueryParamsSchema = (columns: ColumnConfig[]) => {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const column of columns) {
    addColumnFilters(shape, column);
  }

  addGlobalParams(shape, columns);

  return z.object(shape);
};

/**
 * Returns a human-readable description for a filter operator
 */
const getOperatorDescription = (op: FilterOperator): string => {
  const descriptions: Record<FilterOperator, string> = {
    eq: "equals",
    gt: "greater than",
    gte: "greater than or equal",
    lt: "less than",
    lte: "less than or equal",
    like: "LIKE pattern",
    ilike: "ILIKE pattern (case-insensitive)",
    in: "IN list",
    isnull: "IS NULL",
  };
  return descriptions[op];
};

/**
 * Generates an OpenAPI-compliant CRUD router for a database table
 *
 * Creates GET (list with filtering/sorting/pagination) and POST (create) endpoints
 * with full OpenAPI documentation including typed query parameters.
 *
 * @param tableName - Name of the database table
 * @param table - Runtime-generated Drizzle table schema
 * @param connectionString - PostgreSQL connection string
 * @param options - Optional cache bindings, schema version, and column metadata
 * @returns OpenAPIHono router with CRUD endpoints
 *
 * @example
 * const router = createCrudRouter("users", usersTable, connString, { env, schemaVersion, columns });
 */
export function createCrudRouter(
  tableName: string,
  table: RuntimeTable,
  connectionString: string,
  options: CrudRouterOptions = {}
): OpenAPIHono {
  const app = new OpenAPIHono();
  const columns = options.columns ?? [];

  const selectSchema = createSelectSchema(
    table as never
  ) as unknown as z.ZodTypeAny;
  const baseInsertSchema = createInsertSchema(table as never);
  const insertSchema = baseInsertSchema.omit({
    [PRIMARY_KEY_COLUMN]: true,
  }) as unknown as z.ZodTypeAny;

  const queryParamsSchema = buildQueryParamsSchema(columns);

  const cacheKv = options.env?.DATA_CACHE;
  const schemaVersion = options.schemaVersion;
  const cacheEnabled = Boolean(cacheKv && schemaVersion);

  // GET / (List with filtering, sorting, pagination)
  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: [tableName],
      request: {
        query: queryParamsSchema,
      },
      responses: {
        200: {
          content: { "application/json": { schema: z.array(selectSchema) } },
          description: "List of records matching query parameters",
        },
      },
    }),
    async (c) => {
      const cacheControl = c.req.header("X-Cache-Control");
      const shouldBypassCache = cacheControl === "no-cache";

      // Parse query parameters
      const rawQuery = c.req.query();
      const parsedQuery = parseQueryParams(rawQuery, columns);
      const hasParams = hasQueryParams(parsedQuery);

      // Generate appropriate cache key
      const cacheKey = hasParams
        ? generateQueryCacheKey(tableName, parsedQuery)
        : getListCacheKey(tableName);

      // Check cache
      if (!shouldBypassCache && cacheEnabled && cacheKv && schemaVersion) {
        const cached = await readCachedQueryResult(cacheKv, cacheKey);
        if (cached?.version === schemaVersion) {
          scheduleListCacheRevalidation(c, {
            env: options.env,
            connectionString,
            table,
            cacheKey,
            schemaVersion,
            query: parsedQuery,
            columns,
          });
          return c.json(cached.data);
        }
      }

      // Execute query
      const client = postgres(connectionString);
      const db = drizzle(client);

      let results: unknown[];
      if (hasParams) {
        results = await executeQuery({
          db,
          table: table as PgTable,
          query: parsedQuery,
        });
      } else {
        results = await db.select().from(table as never);
      }

      // Cache results
      if (cacheEnabled && cacheKv && schemaVersion) {
        await writeCachedQueryResult(cacheKv, cacheKey, {
          data: results,
          cachedAt: Date.now(),
          version: schemaVersion,
          query: parsedQuery,
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

      // Invalidate all caches for this table (list + query caches)
      if (options.env?.DATA_CACHE) {
        await deleteCachedKey(
          options.env.DATA_CACHE,
          getListCacheKey(tableName)
        );
        // Note: Query-specific caches will naturally expire or be invalidated
        // when the schema version changes. For immediate invalidation of all
        // query caches, we would need to track cache keys per table.
      }

      return c.json(result[0], 201);
    }
  );

  return app;
}
