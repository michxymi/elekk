import type { Context } from "hono";
import type { z } from "zod";

export type Env = {
  HYPERDRIVE: Hyperdrive;
  DATA_CACHE?: KVNamespace;
};

export type AppContext = Context<{ Bindings: Env }>;

export type ColumnConfig = {
  name: string;
  type: string;
  nullable: boolean;
};

export type RuntimeSchema = {
  table: unknown;
  zodSchema: z.ZodObject<Record<string, z.ZodTypeAny>>;
};
