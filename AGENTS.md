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

1. **Request arrives** at `/api/:table/*` (e.g., `/api/users/?name=John&order_by=-created_at`)
2. **Drift detection** checks if table schema changed via `getTableVersion()` (src/lib/introspector.ts:7)
3. **Cache lookup** checks `HOT_CACHE` for existing router
4. **On cache miss:**
   - Introspect table columns via `getTableConfig()` (src/lib/introspector.ts:26)
   - Build runtime Drizzle schema + Zod validation via `buildRuntimeSchema()` (src/lib/builder.ts:25)
   - Generate CRUD router with OpenAPI routes and typed query params via `createCrudRouter()` (src/lib/generator.ts)
   - Cache router for subsequent requests
5. **Query parameter parsing**
   - GET: `parseQueryParams()` extracts filters, sorting, pagination
   - POST: `parseInsertParams()` extracts returning fields, on_conflict configuration
6. **Query building**
   - GET: `executeQuery()` constructs Drizzle ORM query with WHERE, ORDER BY, LIMIT, OFFSET
   - POST: `executeInsert()` constructs INSERT with optional ON CONFLICT and RETURNING clauses
7. **Data caching** with SWR pattern - stale data served immediately, fresh data fetched in background

### Core Modules

**src/index.ts** - Main application entry point
- Implements hot-caching layer with schema drift detection (HOT_CACHE for routers, OPENAPI_CACHE for spec)
- Routes all `/api/:table/*` requests to dynamically generated routers
- Exposes OpenAPI docs at `/openapi.json` and Swagger UI at `/docs`
- **Performance optimization:** Lazy-loads Swagger UI via dynamic import to reduce cold start bundle size by 20-40ms

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
- Generates fully-typed query parameter schemas based on column metadata for GET and POST
- `buildQueryParamsSchema()` - Generates GET query params schema with OpenAPI decorators
- `buildInsertParamsSchema()` - Generates POST query params schema (returning, on_conflict) with OpenAPI decorators
- Implements: GET / (list with filtering/sorting/pagination), POST / (create with upsert support)
- TODO: Add GET /:id, PUT /:id, DELETE /:id endpoints

**src/lib/query-params.ts** - GET query parameter parsing
- `parseQueryParams()` - Parses query string into structured `ParsedQuery` object
- `parseFilterKey()` - Extracts field name and operator from param keys (e.g., `age__gt` → field: `age`, operator: `gt`)
- `coerceValue()` - Type coercion based on PostgreSQL column types
- `generateQueryCacheKey()` - Creates deterministic cache keys for query results
- Supports operators: `eq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `isnull`

**src/lib/query-builder.ts** - Drizzle ORM SELECT query construction
- `buildWhereClause()` - Converts filter conditions to Drizzle SQL expressions
- `buildOrderByClause()` - Converts sort directives to Drizzle order expressions
- `buildSelectColumns()` - Builds partial field selection for queries
- `executeQuery()` - Main entry point for executing filtered/sorted/paginated queries

**src/lib/insert-params.ts** - POST query parameter parsing
- `parseInsertParams()` - Parses POST query string into structured `ParsedInsertParams` object
- `parseReturningParam()` - Parses returning field selection (e.g., `returning=id,name`)
- `parseOnConflictParams()` - Parses on_conflict configuration for upsert behavior
- `hasInsertParams()` - Checks if parsed params have any active configuration

**src/lib/insert-builder.ts** - Drizzle ORM INSERT query construction
- `buildReturningColumns()` - Builds column map for selective RETURNING clause
- `buildUpdateSet()` - Builds update set for ON CONFLICT DO UPDATE using EXCLUDED values
- `executeInsert()` - Main entry point for executing INSERT with returning/onConflict support

**src/lib/data-cache.ts** - KV caching utilities
- `readCachedQueryResult()` / `writeCachedQueryResult()` - Query result caching
- `readCachedOpenApi()` / `writeCachedOpenApi()` - OpenAPI spec caching
- `getListCacheKey()` / `getQueryCachePrefix()` - Cache key generation
- Implements SWR (stale-while-revalidate) caching pattern

### Configuration

**wrangler.jsonc** - Cloudflare Workers configuration
- Hyperdrive binding: `HYPERDRIVE` (configure `id` with your Hyperdrive database ID)
- Node.js compatibility enabled for postgres client
- Entry point: `src/index.ts`
- **Smart Placement enabled:** `placement.mode: "smart"` runs Worker near database to minimize latency
- Observability enabled for monitoring and logging

**biome.jsonc** - Code quality configuration
- Extends `ultracite/core` preset
- Provides Rust-based linting and formatting

## Performance Characteristics

**Current Setup (Production):**
- Database: Neon Postgres in us-east-1
- Smart Placement: Enabled (Worker runs near database)
- Connection Pooling: Hyperdrive
- Caching: HOT_CACHE for routers, OPENAPI_CACHE for OpenAPI spec

**Benchmark Results (UK → US-East-1):**
- Cold start: ~680-990ms
- Warm requests: ~215-225ms (dominated by database query execution ~150-200ms)
- OpenAPI spec (cached): ~35-40ms
- Cache speedup: 2.5x

**Performance Bottlenecks:**
1. **Geographic latency:** UK → US-East-1 network RTT is ~80-120ms (physics limit)
2. **Database query execution:** Neon compute + query time ~150-200ms
3. **Worker initialization:** ~50-100ms on cold starts (minimized via lazy-loading)

**Key Insight:** With Hyperdrive connection pooling and Smart Placement enabled, the primary bottleneck is database query execution time, not Worker performance. Further optimization requires either:
- Query result caching (adds data staleness)
- Read replicas in EU (requires ~$69/month Neon Scale plan)

## Database Setup

This project requires a PostgreSQL database accessible via Cloudflare Hyperdrive:

1. Create a Hyperdrive configuration in Cloudflare dashboard
2. Update `wrangler.jsonc` with your Hyperdrive ID
3. Tables are introspected at runtime - no migrations or schema files needed
4. Tables must have an `id` column (automatically marked as primary key)

**Connection Management:**
- Uses `postgres.js` client (NOT `@neondatabase/serverless`)
- Creates new client instances per operation (Hyperdrive handles connection pooling)
- Never calls `client.end()` - Hyperdrive manages connection lifecycle
- Recommended: Use non-pooled Neon endpoint (port 5432, not 6543 with `-pooler`)

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

### Query Parameter Syntax

#### GET Query Parameters

**Filtering (WHERE clauses):**
- `?field=value` - equality (e.g., `?name=John`)
- `?field__gt=5` - greater than
- `?field__gte=5` - greater than or equal
- `?field__lt=10` - less than
- `?field__lte=10` - less than or equal
- `?field__like=%pattern%` - LIKE (case-sensitive)
- `?field__ilike=%pattern%` - ILIKE (case-insensitive)
- `?field__in=val1,val2,val3` - IN array
- `?field__isnull=true` - IS NULL / IS NOT NULL

**Sorting (ORDER BY):**
- `?order_by=name` - ascending
- `?order_by=-name` - descending (prefix with `-`)
- `?order_by=name,-created_at` - multiple columns

**Pagination (LIMIT/OFFSET):**
- `?limit=10` - LIMIT
- `?offset=20` - OFFSET

**Field Selection (SELECT):**
- `?select=id,name,email` - only return specified fields

#### POST Query Parameters (Upsert Support)

**Selective RETURNING:**
- `?returning=id,name,email` - only return specified fields after INSERT

**ON CONFLICT (Upsert):**
- `?on_conflict=email` - column to check for conflicts (must have UNIQUE constraint)
- `?on_conflict_action=nothing` - skip insert on conflict (DO NOTHING), returns 204 No Content if conflict detected
- `?on_conflict_update=name,updated_at` - columns to update on conflict (DO UPDATE)

**Combined Upsert Example:**
```
POST /api/users/?on_conflict=email&on_conflict_update=name,updated_at&returning=id,email
```
Maps to: `INSERT ... ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, updated_at=EXCLUDED.updated_at RETURNING id, email`

**Important:** The `on_conflict` column must have a UNIQUE constraint in the database.

All query parameters are typed per-table based on introspected column metadata and appear in Swagger UI.

### OpenAPI Documentation Features

The `/openapi.json` endpoint generates a complete OpenAPI 3.0 specification dynamically:

- **On-demand generation**: Schema is introspected only when `/openapi.json` is requested (not at startup)
- **Intelligent caching**: Generated spec is cached in memory with schema version tracking
- **Automatic cache invalidation**: When ANY table is added, removed, or modified, the cache is invalidated and the spec regenerates
- **Fast cache hits**: Cached requests return in ~1-2ms
- **Schema change detection**: Uses PostgreSQL transaction IDs (xmin) to detect schema drift
- **Performance**: First request ~100-500ms (introspection), subsequent requests <2ms (cached)
