import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import postgres from "postgres";
import { PRIMARY_KEY_COLUMN } from "@/constants";
import {
  buildCacheUrl,
  readFromCacheApi,
  writeToCacheApi,
} from "@/lib/cache-api";
import {
  bumpTableVersion,
  getTableVersion,
  setTableVersion,
} from "@/lib/data-cache";
import { executeInsert } from "@/lib/insert-builder";
import { hasInsertParams, parseInsertParams } from "@/lib/insert-params";
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

type CacheRevalidationOptions = {
  table: RuntimeTable;
  tableName: string;
  connectionString: string;
  cacheUrl: string;
  query?: ParsedQuery;
};

/**
 * Revalidates the cache by fetching fresh data from the database
 * and writing to Cache API (Stale-While-Revalidate pattern)
 *
 * @param options - Revalidation options including table and cache URL
 */
const revalidateCache = async (options: CacheRevalidationOptions) => {
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

    // Write to Cache API with 60s TTL
    await writeToCacheApi(options.cacheUrl, results, 60);
  } catch (error) {
    console.error("Cache revalidation failed", error);
  }
};

type CacheRevalidationParams = {
  connectionString: string;
  table: RuntimeTable;
  tableName: string;
  cacheUrl: string;
  query?: ParsedQuery;
};

type ExecutionContextHolder = {
  executionCtx?: {
    waitUntil: (promise: Promise<unknown>) => void;
  };
};

const scheduleCacheRevalidation = (
  c: ExecutionContextHolder,
  params: CacheRevalidationParams
) => {
  try {
    if (!c.executionCtx?.waitUntil) {
      return;
    }

    c.executionCtx.waitUntil(
      revalidateCache({
        table: params.table,
        tableName: params.tableName,
        connectionString: params.connectionString,
        cacheUrl: params.cacheUrl,
        query: params.query,
      })
    );
  } catch (error) {
    console.error("Failed to schedule cache revalidation", error);
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
 * Generates a Zod schema for INSERT query parameters with OpenAPI documentation
 *
 * Creates parameters for controlling INSERT behavior:
 * - returning: Select which fields to return after INSERT
 * - on_conflict: Column to check for conflicts (upsert)
 * - on_conflict_action: Action on conflict ('nothing' for DO NOTHING)
 * - on_conflict_update: Columns to update on conflict (DO UPDATE)
 *
 * @param columns - Array of column configurations from database introspection
 * @returns Zod schema for INSERT query parameters with OpenAPI decorators
 */
const buildInsertParamsSchema = (columns: ColumnConfig[]) => {
  const columnNames = columns.map((c) => c.name).join(",");
  const shape: Record<string, z.ZodTypeAny> = {};

  // returning - Select which fields to return after INSERT
  shape.returning = z
    .string()
    .optional()
    .openapi({
      param: { name: "returning", in: "query" },
      description:
        "Comma-separated list of fields to return after INSERT (RETURNING clause)",
      example: columnNames.slice(0, 50),
    });

  // on_conflict - Column to check for conflicts (must be unique/pk)
  shape.on_conflict = z
    .string()
    .optional()
    .openapi({
      param: { name: "on_conflict", in: "query" },
      description:
        "Column to check for conflicts (must have UNIQUE constraint). Enables upsert behavior.",
      example: "email",
    });

  // on_conflict_action - Action to take on conflict
  shape.on_conflict_action = z
    .enum(["nothing", "update"])
    .optional()
    .openapi({
      param: { name: "on_conflict_action", in: "query" },
      description:
        "Action on conflict: 'nothing' (skip insert) or 'update' (requires on_conflict_update)",
      example: "nothing",
    });

  // on_conflict_update - Columns to update on conflict
  shape.on_conflict_update = z
    .string()
    .optional()
    .openapi({
      param: { name: "on_conflict_update", in: "query" },
      description:
        "Comma-separated columns to update on conflict (uses EXCLUDED values). Implies on_conflict_action=update.",
      example: "name,updated_at",
    });

  return z.object(shape);
};

/**
 * Generates a query key for cache URL from parsed query parameters
 */
const generateCacheQueryKey = (
  tableName: string,
  parsedQuery: ParsedQuery,
  hasParams: boolean
): string => {
  if (!hasParams) {
    return "list";
  }
  const prefix = `data:${tableName}:`;
  const fullKey = generateQueryCacheKey(tableName, parsedQuery);
  if (fullKey.startsWith(prefix)) {
    return fullKey.substring(prefix.length);
  }
  return fullKey;
};

type TableVersionParams = {
  cacheEnabled: boolean;
  cacheKv: KVNamespace | undefined;
  tableName: string;
  schemaVersion: string | undefined;
};

/**
 * Gets or initializes the table version from KV (Control Plane)
 */
const resolveTableVersion = async (
  params: TableVersionParams
): Promise<string | undefined> => {
  const { cacheEnabled, cacheKv, tableName, schemaVersion } = params;
  if (!(cacheEnabled && cacheKv)) {
    return schemaVersion;
  }

  const storedVersion = await getTableVersion(cacheKv, tableName);
  if (storedVersion) {
    return storedVersion;
  }

  if (schemaVersion) {
    await setTableVersion(cacheKv, tableName, schemaVersion);
  }
  return schemaVersion;
};

type FetchQueryResultsParams = {
  connectionString: string;
  table: RuntimeTable;
  parsedQuery: ParsedQuery;
  hasParams: boolean;
};

/**
 * Executes a database query and returns results
 */
const fetchQueryResults = async (
  params: FetchQueryResultsParams
): Promise<unknown[]> => {
  const client = postgres(params.connectionString);
  const db = drizzle(client);

  if (params.hasParams) {
    return await executeQuery({
      db,
      table: params.table as PgTable,
      query: params.parsedQuery,
    });
  }
  return await db.select().from(params.table as never);
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
  const insertParamsSchema = buildInsertParamsSchema(columns);

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
      const shouldBypassCache = c.req.header("X-Cache-Control") === "no-cache";

      // Parse query parameters
      const rawQuery = c.req.query();
      const parsedQuery = parseQueryParams(rawQuery, columns);
      const hasParams = hasQueryParams(parsedQuery);

      // Generate query key for cache URL
      const queryKey = generateCacheQueryKey(tableName, parsedQuery, hasParams);

      // Get or initialize table version from KV (Control Plane)
      const tableVersion = await resolveTableVersion({
        cacheEnabled,
        cacheKv,
        tableName,
        schemaVersion,
      });

      // Build Cache API URL with version embedded
      const cacheUrl = tableVersion
        ? buildCacheUrl(tableName, queryKey, tableVersion)
        : null;

      // Check Cache API (Data Plane)
      if (!shouldBypassCache && cacheEnabled && cacheUrl) {
        const cached = await readFromCacheApi<unknown[]>(cacheUrl);
        if (cached) {
          // Schedule SWR revalidation in background
          scheduleCacheRevalidation(c, {
            connectionString,
            table,
            tableName,
            cacheUrl,
            query: parsedQuery,
          });
          return c.json(cached);
        }
      }

      // Execute query (cache miss)
      const results = await fetchQueryResults({
        connectionString,
        table,
        parsedQuery,
        hasParams,
      });

      // Write to Cache API (in background to not block response)
      if (cacheEnabled && cacheUrl) {
        try {
          c.executionCtx?.waitUntil(writeToCacheApi(cacheUrl, results, 60));
        } catch {
          // executionCtx may not be available in test environments
        }
      }

      return c.json(results);
    }
  );

  // POST / (Create with optional upsert via query params)
  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: [tableName],
      request: {
        query: insertParamsSchema,
        body: { content: { "application/json": { schema: insertSchema } } },
      },
      responses: {
        200: {
          content: { "application/json": { schema: selectSchema } },
          description: "Record updated (upsert with ON CONFLICT DO UPDATE)",
        },
        201: {
          content: { "application/json": { schema: selectSchema } },
          description: "Record created",
        },
        204: {
          description:
            "Conflict detected, no insert performed (ON CONFLICT DO NOTHING)",
        },
      },
    }),
    async (c) => {
      const client = postgres(connectionString);
      const db = drizzle(client);
      const body = await c.req.json();

      // Parse INSERT query parameters
      const rawQuery = c.req.query();
      const insertParams = parseInsertParams(rawQuery, columns);

      let result: unknown[];

      if (hasInsertParams(insertParams)) {
        // Use enhanced insert with returning/onConflict support
        result = await executeInsert({
          db,
          table: table as PgTable,
          data: body,
          params: insertParams,
        });
      } else {
        // Simple insert without special params
        result = (await db
          .insert(table as never)
          .values(body)
          .returning()) as unknown[];
      }

      // Handle ON CONFLICT DO NOTHING case - may return empty array
      if (result.length === 0) {
        // For DO NOTHING, return 204 No Content to indicate conflict with no insert
        if (insertParams.onConflict?.action === "nothing") {
          return c.body(null, 204);
        }
        return c.json({ error: "Insert failed" }, 500);
      }

      // Invalidate all caches by bumping table version (Control Plane)
      // New version = new cache URLs = automatic invalidation
      if (options.env?.DATA_CACHE) {
        await bumpTableVersion(options.env.DATA_CACHE, tableName);
      }

      // Return 200 for upsert updates, 201 for new inserts
      // Note: We can't easily distinguish between insert and update with Drizzle,
      // so we return 201 for all successful inserts/upserts
      return c.json(result[0], 201);
    }
  );

  return app;
}
