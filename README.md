# Elekk - Auto-Generated REST APIs

Elekk is a Cloudflare Worker that provides auto-generated REST APIs with OpenAPI 3.1 documentation. It uses runtime schema introspection to dynamically build CRUD endpoints for PostgreSQL tables accessed via Cloudflare Hyperdrive, without requiring predefined schema files.

**Key Features:**
- 🔄 Runtime database schema introspection
- 📝 Auto-generated OpenAPI 3.1 documentation
- ⚡ Tiered caching: Cache API (edge) + KV (control plane) + Memory (routers)
- 🎯 Zero-config CRUD endpoints for any table
- 🔍 SQL-like query parameters (filtering, sorting, pagination)
- 🔄 Upsert support via POST query params (ON CONFLICT)
- 🗑️ Soft delete support (auto-detects `deleted_at`/`is_deleted` columns)
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
├── constants.ts          # Application-wide constants
└── lib/
    ├── introspector.ts   # Database schema introspection
    ├── builder.ts        # Runtime schema construction
    ├── generator.ts      # CRUD router generation
    ├── query-params.ts   # GET query parameter parsing
    ├── query-builder.ts  # Drizzle ORM SELECT query construction
    ├── insert-params.ts  # POST query parameter parsing (upsert)
    ├── insert-builder.ts # Drizzle ORM INSERT query construction
    ├── update-params.ts  # PUT/PATCH query parameter parsing
    ├── update-builder.ts # Drizzle ORM UPDATE query construction
    ├── delete-params.ts  # DELETE query parameter parsing (soft delete)
    ├── delete-builder.ts # Drizzle ORM DELETE/UPDATE query construction
    ├── cache-api.ts      # Cache API utilities (Data Plane)
    └── data-cache.ts     # KV caching utilities (Control Plane)
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
# Create users table (with UNIQUE constraint on email for upsert support)
docker exec -i elekk-postgres psql -U postgres -d elekk_test <<EOF
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
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
Open `http://localhost:8787/docs` in your browser

**Access OpenAPI spec:**
```bash
curl http://localhost:8787/openapi.json
```

### Step 6: Query Parameters

Elekk supports SQL-like query parameters for filtering, sorting, pagination, and field selection:

**Filtering (WHERE clauses):**
```bash
# Equality filter
curl "http://localhost:8787/api/users/?name=Alice%20Johnson"

# Comparison operators (gt, gte, lt, lte)
curl "http://localhost:8787/api/products/?price__gte=2000"

# Pattern matching (like, ilike)
curl "http://localhost:8787/api/users/?email__ilike=%25@example.com"

# IN operator
curl "http://localhost:8787/api/users/?id__in=1,2,3"

# IS NULL check
curl "http://localhost:8787/api/users/?age__isnull=true"
```

**Sorting (ORDER BY):**
```bash
# Ascending sort
curl "http://localhost:8787/api/users/?order_by=name"

# Descending sort (prefix with -)
curl "http://localhost:8787/api/products/?order_by=-price"

# Multiple sort fields
curl "http://localhost:8787/api/users/?order_by=is_active,-created_at"
```

**Pagination (LIMIT/OFFSET):**
```bash
# Limit results
curl "http://localhost:8787/api/users/?limit=10"

# Pagination
curl "http://localhost:8787/api/users/?limit=10&offset=20"
```

**Field Selection (SELECT):**
```bash
# Return only specific fields
curl "http://localhost:8787/api/users/?select=id,name,email"
```

**Combined Example:**
```bash
# Active users, sorted by name, first 10 results, only id and name
curl "http://localhost:8787/api/users/?is_active=true&order_by=name&limit=10&select=id,name"
```

All query parameters are fully documented in the OpenAPI spec and appear in Swagger UI with proper types and descriptions.

### Step 7: POST Query Parameters (Upsert)

Elekk also supports SQL-like query parameters for POST requests, enabling control over RETURNING fields and upsert (ON CONFLICT) behavior:

**Selective RETURNING:**
```bash
# Return only specific fields after INSERT
curl -X POST "http://localhost:8787/api/users/?returning=id,name" \
  -H "Content-Type: application/json" \
  -d '{"name":"New User","email":"new@example.com","is_active":true}'
```

**ON CONFLICT DO NOTHING (Skip on duplicate):**
```bash
# Skip insert if email already exists (requires UNIQUE constraint on email)
# Returns 204 No Content if conflict detected, 201 if inserted
curl -X POST "http://localhost:8787/api/users/?on_conflict=email&on_conflict_action=nothing" \
  -H "Content-Type: application/json" \
  -d '{"name":"Maybe New","email":"existing@example.com","is_active":true}'
```

**ON CONFLICT DO UPDATE (Upsert):**
```bash
# Update name and is_active if email already exists
curl -X POST "http://localhost:8787/api/users/?on_conflict=email&on_conflict_update=name,is_active" \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated Name","email":"existing@example.com","is_active":false}'
```

**Combined Example (Upsert with selective return):**
```bash
# Upsert user, return only id and email
curl -X POST "http://localhost:8787/api/users/?returning=id,email&on_conflict=email&on_conflict_update=name" \
  -H "Content-Type: application/json" \
  -d '{"name":"Upserted User","email":"user@example.com","is_active":true}'
```

| Query Param | SQL Equivalent | Description |
|-------------|----------------|-------------|
| `returning=id,name` | `RETURNING id, name` | Select which fields to return after INSERT |
| `on_conflict=email` | `ON CONFLICT (email)` | Column to check for conflicts (must be UNIQUE) |
| `on_conflict_action=nothing` | `DO NOTHING` | Skip insert on conflict |
| `on_conflict_update=name,age` | `DO UPDATE SET name=EXCLUDED.name, age=EXCLUDED.age` | Update specified columns on conflict |

**Important:** The `on_conflict` column **must** have a UNIQUE constraint in your database for upsert to work. Without it, PostgreSQL will return an error. To add a unique constraint:

```sql
ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
```

### Step 8: DELETE Query Parameters

Elekk supports SQL-like query parameters for DELETE requests, including soft delete support:

**Delete by ID:**
```bash
# Delete a single user by ID
curl -X DELETE "http://localhost:8787/api/users/1"

# Delete with RETURNING (returns deleted record)
curl -X DELETE "http://localhost:8787/api/users/1?returning=id,name,email"
```

**Bulk Delete with Filters:**
```bash
# Delete inactive users
curl -X DELETE "http://localhost:8787/api/users/?is_active=false"

# Delete with multiple filters
curl -X DELETE "http://localhost:8787/api/users/?is_active=false&name__like=%Test%"

# Delete with RETURNING (returns all deleted records)
curl -X DELETE "http://localhost:8787/api/users/?is_active=false&returning=id,email"
```

**Soft Delete (Auto-Detected):**

If your table has a `deleted_at` or `is_deleted` column, Elekk automatically uses soft delete (UPDATE instead of DELETE):

```bash
# Creates/has soft_delete_users table with deleted_at column
docker exec -i elekk-postgres psql -U postgres -d elekk_test <<EOF
CREATE TABLE soft_delete_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  deleted_at TIMESTAMP WITHOUT TIME ZONE
);
INSERT INTO soft_delete_users (name, email) VALUES
  ('Test User', 'test@example.com');
EOF

# This performs UPDATE soft_delete_users SET deleted_at = NOW() WHERE id = 1
curl -X DELETE "http://localhost:8787/api/soft_delete_users/1"
```

**Force Hard Delete:**
```bash
# Override soft delete behavior with hard_delete=true
curl -X DELETE "http://localhost:8787/api/soft_delete_users/1?hard_delete=true"
```

| Query Param | SQL Equivalent | Description |
|-------------|----------------|-------------|
| `returning=id,name` | `RETURNING id, name` | Select which fields to return after DELETE |
| `hard_delete=true` | `DELETE FROM` | Force hard delete even if table has soft delete column |
| `<field>=<value>` | `WHERE field = value` | Filter which records to delete |
| `<field>__<op>=<value>` | `WHERE field <op> value` | All GET filter operators work (eq, gt, gte, lt, lte, like, ilike, in, isnull) |

**Response Codes:**
- `200 OK` - Record(s) deleted, body contains deleted records (with RETURNING)
- `204 No Content` - Record(s) deleted but no RETURNING specified, or no records matched filters
- `404 Not Found` - DELETE by ID where record doesn't exist

### Step 9: PUT/PATCH Query Parameters (Update)

Elekk supports PUT (full replacement) and PATCH (partial update) operations with SQL-like query parameters:

**PUT - Full Resource Replacement:**

PUT requires all non-nullable fields in the request body (except id):

```bash
# Update single user (requires all required fields)
curl -X PUT "http://localhost:8787/api/users/1?returning=id,name,email" \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated Name","email":"updated@example.com","is_active":true}'

# Returns 400 if required fields are missing
curl -X PUT "http://localhost:8787/api/users/1" \
  -H "Content-Type: application/json" \
  -d '{"name":"Only Name"}'  # Missing email, is_active
# Response: { "error": "Missing required fields for full replacement", "missingFields": ["email", "is_active"] }
```

**PATCH - Partial Update:**

PATCH only updates the fields provided in the request body:

```bash
# Update single field
curl -X PATCH "http://localhost:8787/api/users/1?returning=id,name" \
  -H "Content-Type: application/json" \
  -d '{"name":"New Name"}'

# Update multiple fields
curl -X PATCH "http://localhost:8787/api/users/1" \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated","is_active":false}'
```

**Bulk Update with Filters:**

Both PUT and PATCH support bulk updates using filter parameters:

```bash
# PATCH: Update is_active for all users matching filter
curl -X PATCH "http://localhost:8787/api/users/?is_active=false&returning=id,name" \
  -H "Content-Type: application/json" \
  -d '{"is_active":true}'

# PUT: Full replacement for all users matching filter (requires all fields)
curl -X PUT "http://localhost:8787/api/users/?name__like=%Test%" \
  -H "Content-Type: application/json" \
  -d '{"name":"Replaced","email":"replaced@example.com","is_active":true}'
```

| Query Param | SQL Equivalent | Description |
|-------------|----------------|-------------|
| `returning=id,name` | `RETURNING id, name` | Select which fields to return after UPDATE |
| `<field>=<value>` | `WHERE field = value` | Filter which records to update (bulk) |
| `<field>__<op>=<value>` | `WHERE field <op> value` | All GET filter operators work (eq, gt, gte, lt, lte, like, ilike, in, isnull) |

**Response Codes:**
- `200 OK` - Record(s) updated, body contains updated records (with RETURNING)
- `204 No Content` - Record(s) updated but no RETURNING specified
- `400 Bad Request` - PUT missing required fields in body
- `404 Not Found` - PUT/PATCH by ID where record doesn't exist

### Step 10: Test Schema Drift Detection

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

Performance characteristics for a production deployment with Neon PostgreSQL in US-East-1, accessed from UK (transatlantic):

| Metric | Target | Typical Performance (UK → US-East-1) |
|--------|--------|-------------------------------------|
| Cold start (schema introspection + DB query) | < 1000ms | 680-990ms ✓ |
| Cache hits (Cache API edge) | < 100ms | 10-50ms ✓ |
| OpenAPI spec (cached) | < 100ms | 35-40ms ✓ |
| Cache speedup | >= 2.0x | 5-20x ✓ |
| Concurrent (10 parallel requests) | < 600ms avg | 560-580ms ✓ |

### Tiered Caching Architecture

Elekk uses a three-tier caching strategy optimized for Cloudflare Workers:

| Tier | Technology | Purpose | TTL |
|------|------------|---------|-----|
| **Data Plane** | Cache API (`caches.default`) | Query results (JSON) | 60 seconds |
| **Control Plane** | KV Namespace | Schema versions for invalidation | Long/Infinite |
| **Code Plane** | Memory (HOT_CACHE) | Compiled routers & Zod schemas | Worker lifetime |

**Why this architecture?**
- **Cache API** is free, fast (~1-10ms), and designed for high-volume, short-lived data
- **KV** is used only for the control plane (schema versions) - not for query results
- **Memory** caches compiled routers to avoid repeated schema parsing

**Cache Invalidation:**
- POST/PUT/PATCH/DELETE operations bump the table version in KV
- New version = new cache URLs = automatic cache miss
- Old entries expire naturally via TTL (60 seconds)

**Key Performance Factors:**
- **Cache API edge caching**: Query results cached at nearest edge location (~1-10ms)
- **Smart Placement enabled**: Worker runs near database in US-East-1, minimizing Worker↔Database latency (<10ms)
- **Hyperdrive connection pooling**: Eliminates connection establishment overhead (~50-100ms saved)
- **Schema caching**: HOT_CACHE prevents repeated introspection
- **Version-based invalidation**: No expensive cache purging - version bump makes old URLs unreachable

### Performance Optimization Strategies

**✅ Implemented Optimizations:**

1. **Lazy-loaded Swagger UI** - Swagger UI assets only load when accessing `/docs`, reducing cold start bundle size by 20-40ms for API requests
2. **Smart Placement enabled** - Worker runs near database (US-East-1), minimizing Worker↔Database network hops to <10ms
3. **Edge Query Caching (Cache API)** - Query results cached at edge locations for ~1-10ms response times

**Current performance (10-50ms for cached requests) is excellent globally.** Further improvements require accepting trade-offs:

#### Regional Database Replicas (Target: 30-80ms globally for cache misses)
Deploy read replicas closer to users for global low latency on cache misses:

**Important Context:**
- **Hyperdrive provides connection pooling, NOT data replication** - your data still lives in one region (US-East-1)
- **Smart Placement** (already enabled) runs Workers near the database, but users still experience network latency on cache misses
- **Read replicas** physically copy your data to multiple regions (requires Neon Scale plan, ~$69/month)

**With read replicas:**
- Place replica in EU (Frankfurt or London) for EU users
- Route reads to nearest replica via Hyperdrive
- US users: ~30-50ms, EU users: ~30-50ms on cache miss
- Writes still go to primary (US-East-1)

**Trade-offs:**
- ✅ <50ms response times globally for read queries (cache miss)
- ✅ Better user experience for international users
- ❌ Significant cost increase (~$69/month minimum)
- ❌ Eventual consistency for replicas (typically <100ms lag)
- ❌ Only helps read-heavy workloads (90%+ reads)
- ❌ Less impactful now that Cache API handles most reads

## Development

1. Run `pnpm dev` to start local development server
2. Open `http://localhost:8787/docs` for Swagger UI
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
   - Generate CRUD router with OpenAPI routes and typed query parameters
   - Cache router for subsequent requests
5. **Query parsing**
   - GET: extracts filters, sorting, pagination from query parameters
   - POST: extracts returning fields, on_conflict configuration for upserts
   - PUT/PATCH: extracts filters, returning fields for updates
   - DELETE: extracts filters, returning fields, and detects soft delete columns
6. **Query execution**
   - GET: builds Drizzle ORM query with WHERE, ORDER BY, LIMIT, OFFSET
   - POST: builds INSERT with optional ON CONFLICT and RETURNING clauses
   - PUT/PATCH: builds UPDATE with WHERE and RETURNING clauses
   - DELETE: builds DELETE or UPDATE (soft delete) with WHERE and RETURNING
7. **Caching** with SWR (stale-while-revalidate) pattern for fast responses
