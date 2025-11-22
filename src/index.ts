import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { buildRuntimeSchema } from "@/lib/builder";
import { createCrudRouter } from "@/lib/generator";
import { getTableConfig, getTableVersion } from "@/lib/introspector";

type Bindings = { HYPERDRIVE: Hyperdrive };
const app = new OpenAPIHono<{ Bindings: Bindings }>();

// ⚡️ ROUTER CACHE (Simple In-Memory)
// Stores the built API router so we don't rebuild it on every request.
// This is NOT caching data, just the code logic.
const HOT_CACHE: Record<string, { router: OpenAPIHono; version: string }> = {};

app.all("/api/:table/*", async (c) => {
  const tableName = c.req.param("table");
  const connectionString = c.env.HYPERDRIVE.connectionString;

  // 1. Check Schema Version (Drift Detection)
  const currentVersion = await getTableVersion(connectionString, tableName);
  if (!currentVersion) {
    return c.json({ error: "Table not found" }, 404);
  }

  // 2. Check Cache (Hit)
  const cached = HOT_CACHE[tableName];
  if (cached && cached.version === currentVersion) {
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

// Documentation
app.doc("/doc", {
  openapi: "3.0.0",
  info: { version: "1.0", title: "Auto-API" },
});
app.get("/ui", swaggerUI({ url: "/doc" }));

export default app;
