import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { buildRuntimeSchema } from "@/lib/builder";
import { createCrudRouter } from "@/lib/generator";
import {
  getEntireSchemaConfig,
  getSchemaVersion,
  getTableConfig,
  getTableVersion,
} from "@/lib/introspector";

type Bindings = { HYPERDRIVE: Hyperdrive };
const app = new OpenAPIHono<{ Bindings: Bindings }>();

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
const HOT_CACHE: Record<string, { router: OpenAPIHono; version: string }> = {};

/**
 * ⚡️ OPENAPI SPEC CACHE
 *
 * Caches the complete OpenAPI specification to avoid re-introspecting the entire schema on every request.
 *
 * Cache structure:
 * - spec: Complete OpenAPI 3.0 document (dynamic object)
 * - version: Global schema version string (aggregate of all table versions)
 *
 * Cache invalidation:
 * - Automatic: When global schema version changes (table added/removed/modified)
 * - Manual: X-Cache-Control: no-cache header bypasses cache lookup (for performance testing)
 *
 * Performance:
 * - Cache miss: 100-500ms (full schema introspection)
 * - Cache hit: <2ms (memory lookup)
 */
// biome-ignore lint/suspicious/noExplicitAny: OpenAPI spec is a dynamic object structure
let OPENAPI_CACHE: { spec: any; version: string } | null = null;

app.all("/api/:table/*", async (c) => {
  const tableName = c.req.param("table");
  const connectionString = c.env.HYPERDRIVE.connectionString;

  // 1. Check Schema Version (Drift Detection)
  const currentVersion = await getTableVersion(connectionString, tableName);
  if (!currentVersion) {
    return c.json({ error: "Table not found" }, 404);
  }

  // 2. Check Cache (Hit)
  // Support X-Cache-Control: no-cache header to bypass cache for performance testing
  const cacheControl = c.req.header("X-Cache-Control");
  const shouldBypassCache = cacheControl === "no-cache";

  const cached = HOT_CACHE[tableName];
  if (!shouldBypassCache && cached && cached.version === currentVersion) {
    const strippedRequest = new Request(
      c.req.url.replace(`/api/${tableName}`, ""),
      c.req.raw
    );
    return cached.router.fetch(strippedRequest);
  }

  // 3. Cache Miss: Introspect & Rebuild
  const rawColumns = await getTableConfig(connectionString, tableName);
  if (!rawColumns) {
    return c.json({ error: "Table not found" }, 404);
  }
  const { table } = buildRuntimeSchema(tableName, rawColumns);

  // 4. Create the Router
  const router = createCrudRouter(tableName, table, connectionString);

  // 5. Update Cache
  HOT_CACHE[tableName] = { router, version: currentVersion };

  // 6. Serve Request
  const strippedRequest = new Request(
    c.req.url.replace(`/api/${tableName}`, ""),
    c.req.raw
  );
  return router.fetch(strippedRequest);
});

// Documentation - OpenAPI Spec with Caching
app.get("/openapi.json", async (c) => {
  const connectionString = c.env.HYPERDRIVE.connectionString;

  // 1. Get current global schema version
  const currentVersion = await getSchemaVersion(connectionString);
  if (!currentVersion) {
    return c.json({ error: "Failed to retrieve schema version" }, 500);
  }

  // 2. Return cached spec if version matches
  // Support X-Cache-Control: no-cache header to bypass cache for performance testing
  const cacheControl = c.req.header("X-Cache-Control");
  const shouldBypassCache = cacheControl === "no-cache";

  if (
    !shouldBypassCache &&
    OPENAPI_CACHE &&
    OPENAPI_CACHE.version === currentVersion
  ) {
    return c.json(OPENAPI_CACHE.spec);
  }

  // 3. Cache miss or version changed - regenerate spec
  const schemaConfig = await getEntireSchemaConfig(connectionString);
  const tables = Object.keys(schemaConfig);

  // 4. Create temporary registry to collect all route definitions
  const tempApp = new OpenAPIHono();

  // 5. Generate CRUD router for each table and merge into temp app
  for (const tableName of tables) {
    const columns = schemaConfig[tableName];
    const { table } = buildRuntimeSchema(tableName, columns);
    const router = createCrudRouter(tableName, table, connectionString);

    // Mount the router at the proper path to ensure correct OpenAPI paths
    tempApp.route(`/api/${tableName}`, router);
  }

  // 6. Generate the complete OpenAPI document
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
        url: new URL(c.req.url).origin,
        description: "Current environment",
      },
    ],
  });

  // 7. Cache the generated spec
  OPENAPI_CACHE = { spec, version: currentVersion };

  return c.json(spec);
});

// Swagger UI
app.get("/docs", swaggerUI({ url: "/openapi.json" }));

export default app;
