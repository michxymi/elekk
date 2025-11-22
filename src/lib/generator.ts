import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/postgres-js";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import postgres from "postgres";

export function createCrudRouter(
  tableName: string,
  table: any,
  connectionString: string
) {
  const app = new OpenAPIHono();

  // Auto-generate Zod schemas
  const selectSchema = createSelectSchema(table);
  const insertSchema = createInsertSchema(table);

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
      const client = postgres(connectionString);
      const db = drizzle(client);
      const results = await db.select().from(table);
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
      const result = await db.insert(table).values(body).returning();
      return c.json(result[0], 201);
    }
  );

  return app;
}
