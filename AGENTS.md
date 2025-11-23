# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Elekk is a Cloudflare Worker that provides auto-generated REST APIs with OpenAPI 3.1 documentation. It uses runtime schema introspection to dynamically build CRUD endpoints for PostgreSQL tables accessed via Cloudflare Hyperdrive, without requiring predefined schema files.

**Key Technologies:**
- Cloudflare Workers (serverless runtime)
- Hono + @hono/zod-openapi (OpenAPI-compliant routing)
- Drizzle ORM (database operations)
- Cloudflare Hyperdrive (database connection pooling)
- Zod (schema validation)

## Development Commands

```bash
# Start local development server with hot reload
pnpm dev

# Deploy to Cloudflare Workers
pnpm deploy

# Format and fix code issues
pnpm dlx ultracite fix

# Check code without auto-fixing
pnpm dlx ultracite check

# Generate TypeScript types for Cloudflare bindings
pnpm cf-typegen

# Run performance benchmarks
pnpm benchmark
```

## Architecture

### Runtime API Generation Flow

The application follows a **schema-first, runtime-introspection** architecture:

1. **Request arrives** at `/api/:table/*` (e.g., `/api/users/`)
2. **Drift detection** checks if table schema changed via `getTableVersion()` (src/lib/introspector.ts:7)
3. **Cache lookup** checks `HOT_CACHE` for existing router
4. **On cache miss:**
   - Introspect table columns via `getTableConfig()` (src/lib/introspector.ts:26)
   - Build runtime Drizzle schema + Zod validation via `buildRuntimeSchema()` (src/lib/builder.ts:25)
   - Generate CRUD router with OpenAPI routes via `createCrudRouter()` (src/lib/generator.ts:6)
   - Cache router for subsequent requests
5. **Route request** through generated router

### Core Modules

**src/index.ts** - Main application entry point
- Implements hot-caching layer with schema drift detection
- Routes all `/api/:table/*` requests to dynamically generated routers
- Exposes OpenAPI docs at `/openapi.json` and Swagger UI at `/docs`

**src/constants.ts** - Application-wide constants
- Defines `PRIMARY_KEY_COLUMN` ("id")

**src/lib/introspector.ts** - Database schema introspection
- `getSchemaVersion()` - Global schema version tracking for OpenAPI cache invalidation
- `getTableVersion()` - Fast per-table schema change detection using PostgreSQL transaction IDs (xmin)
- `getTableConfig()` - Retrieves column metadata for a single table
- `getEntireSchemaConfig()` - Full database schema introspection for OpenAPI spec generation

**src/lib/builder.ts** - Runtime schema construction
- Maps PostgreSQL types to Drizzle ORM column builders
- Maps PostgreSQL types to Zod validators
- Constructs pgTable and Zod schemas at runtime from introspected metadata

**src/lib/generator.ts** - CRUD router generation
- Creates OpenAPIHono router with auto-generated endpoints
- Generates Zod schemas for request/response validation via drizzle-zod
- Currently implements: GET / (list), POST / (create)
- TODO: Add GET /:id, PUT /:id, DELETE /:id endpoints

### Configuration

**wrangler.jsonc** - Cloudflare Workers configuration
- Hyperdrive binding: `HYPERDRIVE` (configure `id` with your Hyperdrive database ID)
- Node.js compatibility enabled for postgres client
- Entry point: `src/index.ts`

**biome.jsonc** - Code quality configuration
- Extends `ultracite/core` preset
- Provides Rust-based linting and formatting

## Database Setup

This project requires a PostgreSQL database accessible via Cloudflare Hyperdrive:

1. Create a Hyperdrive configuration in Cloudflare dashboard
2. Update `wrangler.jsonc` with your Hyperdrive ID
3. Tables are introspected at runtime - no migrations or schema files needed
4. Tables must have an `id` column (automatically marked as primary key)

## Code Standards

This project uses **Ultracite** for automated code quality enforcement. Key principles:

- Explicit type safety: Use explicit types for parameters/returns, prefer `unknown` over `any`
- Modern TypeScript: Arrow functions, `for...of` loops, optional chaining, destructuring
- Async/await over promise chains
- Early returns over nested conditionals
- Remove `console.log`/`debugger` statements from production code

Run `pnpm dlx ultracite fix` before committing to auto-fix most issues.

## API Usage

After deployment, access:
- **Swagger UI:** `https://your-worker.workers.dev/docs`
- **OpenAPI spec:** `https://your-worker.workers.dev/openapi.json`
- **Table endpoints:** `https://your-worker.workers.dev/api/{table_name}/`

Example: `GET https://your-worker.workers.dev/api/users/` returns all users from the `users` table.

### OpenAPI Documentation Features

The `/openapi.json` endpoint generates a complete OpenAPI 3.0 specification dynamically:

- **On-demand generation**: Schema is introspected only when `/openapi.json` is requested (not at startup)
- **Intelligent caching**: Generated spec is cached in memory with schema version tracking
- **Automatic cache invalidation**: When ANY table is added, removed, or modified, the cache is invalidated and the spec regenerates
- **Fast cache hits**: Cached requests return in ~1-2ms
- **Schema change detection**: Uses PostgreSQL transaction IDs (xmin) to detect schema drift
- **Performance**: First request ~100-500ms (introspection), subsequent requests <2ms (cached)
