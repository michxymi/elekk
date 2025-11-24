import { OpenAPIHono } from "@hono/zod-openapi";
import { buildRuntimeSchema } from "@/lib/builder";
import { readCachedOpenApi, writeCachedOpenApi } from "@/lib/data-cache";
import { createCrudRouter } from "@/lib/generator";
import {
  getEntireSchemaConfig,
  getSchemaVersion,
  getTableConfig,
  getTableVersion,
} from "@/lib/introspector";
import type { AppContext, ColumnConfig, Env } from "@/types";

const app = new OpenAPIHono<{ Bindings: Env }>();

/**
 * ⚡️ ROUTER CACHE (Simple In-Memory)
 *
 * Stores the built API router so we don't rebuild it on every request.
 * This is NOT caching data, just the code logic (router + schema).
 *
 * Cache structure:
 * - Key: table name
 * - Value: { router: OpenAPIHono, version: string }
 *
 * Cache invalidation:
 * - Automatic: Schema drift detection via PostgreSQL xmin transaction IDs (~1-2ms overhead)
 * - Manual: X-Cache-Control: no-cache header bypasses cache lookup (for performance testing)
 */
export const HOT_CACHE: Record<
  string,
  { router: OpenAPIHono; version: string }
> = {};

const SCHEMA_CACHE_PREFIX = "schema:";
export const getSchemaCacheKey = (tableName: string) =>
  `${SCHEMA_CACHE_PREFIX}${tableName}`;

type SchemaCachePayload = {
  version: string;
  columns: ColumnConfig[];
};

const persistSchemaCache = async (
  env: Env,
  tableName: string,
  payload: SchemaCachePayload
) => {
  if (!env.DATA_CACHE) {
    return;
  }
  try {
    await env.DATA_CACHE.put(
      getSchemaCacheKey(tableName),
      JSON.stringify(payload)
    );
  } catch (error) {
    console.error("Failed to persist schema cache to KV", error);
  }
};

const loadSchemaCache = async (
  env: Env,
  tableName: string
): Promise<SchemaCachePayload | null> => {
  if (!env.DATA_CACHE) {
    return null;
  }

  const raw = await env.DATA_CACHE.get(getSchemaCacheKey(tableName));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SchemaCachePayload;
  } catch (error) {
    console.error("Failed to parse schema cache payload", error);
    return null;
  }
};

type RouterBuildOptions = {
  tableName: string;
  columns: ColumnConfig[];
  connectionString: string;
  env: Env;
  schemaVersion: string;
};

const buildRouterFromColumns = (options: RouterBuildOptions) => {
  const { tableName, columns, connectionString, env, schemaVersion } = options;
  const { table } = buildRuntimeSchema(tableName, columns);
  const router = createCrudRouter(tableName, table, connectionString, {
    env,
    schemaVersion,
    columns,
  });
  return router;
};

const invalidateSchemaCaches = async (env: Env, tableName: string) => {
  delete HOT_CACHE[tableName];

  if (!env.DATA_CACHE) {
    return;
  }

  try {
    await env.DATA_CACHE.delete(getSchemaCacheKey(tableName));
  } catch (error) {
    console.error("Failed to delete schema cache from KV", error);
  }
};

export const validateSchemaCache = async (
  env: Env,
  connectionString: string,
  tableName: string,
  cachedVersion: string
) => {
  try {
    const latestVersion = await getTableVersion(connectionString, tableName);
    if (!latestVersion || latestVersion !== cachedVersion) {
      await invalidateSchemaCaches(env, tableName);
    }
  } catch (error) {
    console.error("Schema cache validation failed", error);
  }
};

type SchemaValidationParams = {
  env: Env;
  tableName: string;
  cachedVersion: string;
};

const scheduleSchemaValidation = (
  c: AppContext,
  params: SchemaValidationParams
) => {
  try {
    const waitUntil = c.executionCtx?.waitUntil;
    if (!waitUntil) {
      return;
    }

    waitUntil(
      validateSchemaCache(
        params.env,
        params.env.HYPERDRIVE.connectionString,
        params.tableName,
        params.cachedVersion
      )
    );
  } catch {
    // ExecutionContext is not available in tests or some runtimes.
  }
};

const forwardRequestToRouter = (
  router: OpenAPIHono,
  tableName: string,
  c: AppContext
) => {
  const strippedRequest = new Request(
    c.req.url.replace(`/api/${tableName}`, ""),
    c.req.raw
  );
  return router.fetch(strippedRequest);
};

const buildOpenApiDocument = async (
  connectionString: string,
  requestUrl: string
) => {
  const schemaConfig = await getEntireSchemaConfig(connectionString);
  const tables = Object.keys(schemaConfig);

  const tempApp = new OpenAPIHono();

  for (const tableName of tables) {
    const columns = schemaConfig[tableName];
    if (!columns) {
      continue;
    }
    const { table } = buildRuntimeSchema(tableName, columns);
    const router = createCrudRouter(tableName, table, connectionString, {
      columns,
    });

    tempApp.route(`/api/${tableName}`, router);
  }

  const spec = tempApp.getOpenAPIDocument({
    openapi: "3.0.0",
    info: {
      version: "1.0.0",
      title: "Elekk Auto-API",
      description:
        "Auto-generated REST API with runtime schema introspection for PostgreSQL tables",
    },
    servers: [
      {
        url: requestUrl,
        description: "Current environment",
      },
    ],
  });

  return spec;
};

type OpenApiRevalidationParams = {
  env: Env;
  connectionString: string;
  requestUrl: string;
  version: string;
};

const generateAndCacheOpenApiSpec = async (
  params: OpenApiRevalidationParams
) => {
  const spec = await buildOpenApiDocument(
    params.connectionString,
    params.requestUrl
  );
  await writeCachedOpenApi(params.env.DATA_CACHE, {
    spec,
    version: params.version,
    cachedAt: Date.now(),
  });
  return spec;
};

const scheduleOpenApiRevalidation = (
  c: AppContext,
  params: OpenApiRevalidationParams
) => {
  try {
    const waitUntil = c.executionCtx?.waitUntil;
    if (!waitUntil) {
      return;
    }

    waitUntil(generateAndCacheOpenApiSpec(params));
  } catch {
    // ExecutionContext may not be available in some environments (tests).
  }
};

app.all("/api/:table/*", async (c) => {
  const tableName = c.req.param("table");
  const connectionString = c.env.HYPERDRIVE.connectionString;

  // Support X-Cache-Control: no-cache header to bypass cache for performance testing
  const cacheControl = c.req.header("X-Cache-Control");
  const shouldBypassCache = cacheControl === "no-cache";

  // 1. Check HOT_CACHE first (no DB call) - serve immediately, validate in background
  if (!shouldBypassCache) {
    const cached = HOT_CACHE[tableName];
    if (cached) {
      scheduleSchemaValidation(c, {
        env: c.env,
        tableName,
        cachedVersion: cached.version,
      });
      return forwardRequestToRouter(cached.router, tableName, c);
    }
  }

  // 2. HOT_CACHE miss - need to check KV or rebuild from DB
  // Now we need the version for cache validation
  const currentVersion = await getTableVersion(connectionString, tableName);
  if (!currentVersion) {
    return c.json({ error: "Table not found" }, 404);
  }

  // 3. Check KV schema cache
  if (!shouldBypassCache) {
    const cachedSchema = await loadSchemaCache(c.env, tableName);
    if (cachedSchema?.version === currentVersion) {
      const router = buildRouterFromColumns({
        tableName,
        columns: cachedSchema.columns,
        connectionString,
        env: c.env,
        schemaVersion: cachedSchema.version,
      });
      HOT_CACHE[tableName] = { router, version: cachedSchema.version };
      scheduleSchemaValidation(c, {
        env: c.env,
        tableName,
        cachedVersion: cachedSchema.version,
      });
      return forwardRequestToRouter(router, tableName, c);
    }
  }

  // 4. Cache Miss: Introspect & Rebuild
  const rawColumns = await getTableConfig(connectionString, tableName);
  if (!rawColumns) {
    return c.json({ error: "Table not found" }, 404);
  }

  const router = buildRouterFromColumns({
    tableName,
    columns: rawColumns,
    connectionString,
    env: c.env,
    schemaVersion: currentVersion,
  });

  HOT_CACHE[tableName] = { router, version: currentVersion };
  await persistSchemaCache(c.env, tableName, {
    version: currentVersion,
    columns: rawColumns,
  });

  return forwardRequestToRouter(router, tableName, c);
});

// Documentation - OpenAPI Spec with Caching
app.get("/openapi.json", async (c) => {
  const connectionString = c.env.HYPERDRIVE.connectionString;
  const requestUrl = new URL(c.req.url).origin;

  // 1. Get current global schema version
  const currentVersion = await getSchemaVersion(connectionString);
  if (!currentVersion) {
    return c.json({ error: "Failed to retrieve schema version" }, 500);
  }

  // 2. Return cached spec if version matches
  const cacheControl = c.req.header("X-Cache-Control");
  const shouldBypassCache = cacheControl === "no-cache";
  const cachedSpec = await readCachedOpenApi(c.env.DATA_CACHE);

  if (!shouldBypassCache && cachedSpec?.version === currentVersion) {
    scheduleOpenApiRevalidation(c, {
      env: c.env,
      connectionString,
      requestUrl,
      version: currentVersion,
    });
    return c.json(cachedSpec.spec);
  }

  const spec = await generateAndCacheOpenApiSpec({
    env: c.env,
    connectionString,
    requestUrl,
    version: currentVersion,
  });

  return c.json(spec);
});

// Swagger UI - Lazy loaded to reduce cold start time
app.get("/docs", async (c, next) => {
  const { swaggerUI } = await import("@hono/swagger-ui");
  const handler = swaggerUI({ url: "/openapi.json" });
  // biome-ignore lint/suspicious/noExplicitAny: Hono context types are incompatible between libraries
  return handler(c as any, next);
});

export default app;
