# Elekk - Auto-Generated REST APIs

Elekk is a Cloudflare Worker that provides auto-generated REST APIs with OpenAPI 3.1 documentation. It uses runtime schema introspection to dynamically build CRUD endpoints for PostgreSQL tables accessed via Cloudflare Hyperdrive, without requiring predefined schema files.

**Key Features:**
- 🔄 Runtime database schema introspection
- 📝 Auto-generated OpenAPI 3.1 documentation
- ⚡ Hot-caching with schema drift detection
- 🎯 Zero-config CRUD endpoints for any table
- 🔌 PostgreSQL via Cloudflare Hyperdrive

**Tech Stack:** Cloudflare Workers, Hono, @hono/zod-openapi, Drizzle ORM, Zod

## Quick Start

1. Sign up for [Cloudflare Workers](https://workers.dev)
2. Clone this project and install dependencies: `pnpm install`
3. Set up a Cloudflare Hyperdrive database connection
4. Update `wrangler.jsonc` with your Hyperdrive ID
5. Run `wrangler login` to authenticate
6. Run `pnpm deploy` to publish

## Project Structure

```
src/
├── index.ts              # Main application with hot-caching
├── types.ts              # TypeScript type definitions
└── lib/
    ├── introspector.ts   # Database schema introspection
    ├── builder.ts        # Runtime schema construction
    └── generator.ts      # CRUD router generation
```

## Local Testing

### Prerequisites
- Docker Desktop installed
- pnpm installed
- Project dependencies installed (`pnpm install`)

### Step 1: Start PostgreSQL Database

Start a PostgreSQL container with Docker:

```bash
docker run --name elekk-postgres \
  -e POSTGRES_PASSWORD=test123 \
  -e POSTGRES_DB=elekk_test \
  -p 5432:5432 \
  -d postgres:16-alpine
```

### Step 2: Create Test Tables

Create sample tables with test data:

```bash
# Create users table
docker exec -i elekk-postgres psql -U postgres -d elekk_test <<EOF
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO users (name, email) VALUES
  ('Alice Johnson', 'alice@example.com'),
  ('Bob Smith', 'bob@example.com');
EOF

# Create products table
docker exec -i elekk-postgres psql -U postgres -d elekk_test <<EOF
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  in_stock BOOLEAN DEFAULT true
);
INSERT INTO products (name, price) VALUES
  ('Widget', 1999),
  ('Gadget', 2999);
EOF
```

### Step 3: Configure Local Connection

Add the local connection string to `wrangler.jsonc`:

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "<YOUR_DATABASE_ID>",
    "localConnectionString": "postgresql://postgres:test123@localhost:5432/elekk_test"
  }
]
```

### Step 4: Start Development Server

```bash
pnpm dev
```

Server will start at `http://localhost:8787`

### Step 5: Test the API

**Test GET (list all users):**
```bash
curl http://localhost:8787/api/users/
```

**Test POST (create new user):**
```bash
curl -X POST http://localhost:8787/api/users/ \
  -H "Content-Type: application/json" \
  -d '{"name":"Charlie Brown","email":"charlie@example.com","is_active":true}'
```

**Test multiple tables:**
```bash
curl http://localhost:8787/api/products/
```

**Access Swagger UI:**
Open `http://localhost:8787/ui` in your browser

**Access OpenAPI spec:**
```bash
curl http://localhost:8787/doc
```

### Step 6: Test Schema Drift Detection

Modify the database schema and watch Elekk automatically detect changes:

```bash
# Add a new column
docker exec elekk-postgres psql -U postgres -d elekk_test \
  -c "ALTER TABLE users ADD COLUMN phone TEXT;"

# Make a request - cache will be invalidated and schema re-introspected
curl http://localhost:8787/api/users/
```

### Cleanup

Stop and remove the PostgreSQL container:

```bash
docker stop elekk-postgres
docker rm elekk-postgres
```

## Performance Benchmarks

Elekk includes a comprehensive benchmark suite to measure API performance across different scenarios.

### Running Benchmarks

```bash
pnpm benchmark
```

### Expected Performance

Performance characteristics for a production deployment with Supabase PostgreSQL in Europe (Ireland) accessed globally:

| Metric | Target | Typical Performance |
|--------|--------|---------------------|
| Cold start (schema introspection + DB query) | < 1000ms | 150-300ms ✓ |
| Warm requests (cached schema, DB query) | < 150ms | 70-80ms ✓ |
| OpenAPI spec (cached) | < 100ms | 25-35ms ✓ |
| Cache speedup | >= 1.2x | 1.5-2x ✓ |
| Concurrent (10 parallel requests) | < 250ms avg | 150-200ms ✓ |

**Key Performance Factors:**
- **Network latency dominates**: ~50-100ms round-trip for intercontinental requests
- **Hyperdrive connection pooling**: Eliminates connection overhead
- **Schema caching**: Hot-cache prevents repeated introspection
- **Database location**: Performance varies based on Supabase region

### Performance Optimization Strategies

Current performance (70-80ms for cached requests) is excellent for a database-backed API, but can be improved further:

#### 1. **Add Edge Query Caching** (Target: <10ms)
Cache actual query results at the Cloudflare edge using KV or Cache API:

```typescript
// Example: Cache query results globally
const cacheKey = `${tableName}:list:${hash(filters)}`;
let result = await env.CACHE_KV.get(cacheKey, { type: "json" });

if (!result) {
  result = await db.select().from(table);
  await env.CACHE_KV.put(cacheKey, JSON.stringify(result), {
    expirationTtl: 60, // Cache for 60 seconds
  });
}
```

**Tradeoffs:**
- ✅ 5-10ms response times globally
- ✅ Reduced database load
- ❌ Stale data (requires cache invalidation strategy)
- ❌ Additional complexity for write operations

#### 2. **Regional Database Replicas**
Deploy read replicas closer to users:

- Use Supabase read replicas in multiple regions
- Route reads to nearest replica via Hyperdrive
- Significant cost increase but <50ms globally

#### 3. **Smart Placement**
Enable Cloudflare Smart Placement to run Workers closer to your database:

```jsonc
// wrangler.jsonc
{
  "placement": { "mode": "smart" }
}
```

**Note:** Smart Placement optimizes for database proximity, which may increase latency for users far from the database region.

## Development

1. Run `pnpm dev` to start local development server
2. Open `http://localhost:8787/ui` for Swagger UI
3. Changes in `src/` trigger automatic reload
4. Run `pnpm dlx ultracite fix` to format code before committing
5. Run `npx tsx scripts/benchmark.ts` to test performance

## How It Works

1. **Request arrives** at `/api/:table/*`
2. **Drift detection** checks if table schema changed via PostgreSQL transaction IDs
3. **Cache lookup** checks `HOT_CACHE` for existing router
4. **On cache miss:**
   - Introspect table columns from `information_schema`
   - Build runtime Drizzle schema + Zod validation
   - Generate CRUD router with OpenAPI routes
   - Cache router for subsequent requests
5. **Route request** through generated router

See [CLAUDE.md](./CLAUDE.md) for detailed development guidelines.
