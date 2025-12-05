#!/usr/bin/env tsx

/**
 * Elekk Performance Benchmark Suite
 *
 * Comprehensive performance benchmarks for the deployed Elekk API.
 * Benchmarks cache behavior, introspection overhead, CRUD operations,
 * GET query parameters (filtering, sorting, pagination, field selection),
 * and POST query parameters (returning, on_conflict upsert).
 *
 * Tiered Caching Architecture:
 * - Data Plane: Cloudflare Cache API for query results (60s TTL, edge-cached)
 * - Control Plane: KV for schema versions (invalidation triggers)
 * - Code Plane: Memory (HOT_CACHE) for compiled routers (worker lifetime)
 *
 * Performance Targets:
 * These targets are calibrated for transatlantic latency (UK → US-East-1):
 * - Cold starts: <1000ms (includes Worker init + DB introspection + query)
 * - Cache hits: <100ms (Cache API edge lookup, no DB query)
 * - OpenAPI cache: <100ms (in-memory cache, no DB query)
 * - Concurrent load: <600ms average (accounts for connection pooling overhead)
 *
 * Geographic Context:
 * - Database: Neon Postgres in us-east-1 (free tier)
 * - Network RTT UK→US-East: ~80-120ms baseline
 * - Smart Placement: Worker runs near database to minimize DB latency
 * - Cache API: Edge-cached responses for fast cache hits (~1-10ms)
 *
 * Neon Free Tier Behavior:
 * - Autosuspend: Database suspends after 5 minutes of inactivity (cannot be configured)
 * - Cold start penalty: +500-800ms on first query after suspension
 * - Mitigation: This script includes a warm-up phase to wake the database before benchmarks
 * - Note: Benchmarks run immediately after one another will show better performance than
 *   benchmarks run after 5+ minutes of inactivity
 */

const API_BASE_URL = process.env.API_URL;

if (!API_BASE_URL) {
  console.error(
    "❌ Error: API_URL environment variable is not set. Please set it to your deployed worker URL."
  );
  console.error("Example: export API_URL=https://elekk.example.workers.dev");
  process.exit(1);
}

// Validate URL format
try {
  new URL(API_BASE_URL);
} catch {
  console.error(`❌ Error: API_URL is not a valid URL: ${API_BASE_URL}`);
  console.error("Expected format: https://your-worker.workers.dev");
  process.exit(1);
}

// ANSI color codes for pretty output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

type BenchmarkResult = {
  name: string;
  duration: number;
  target?: string;
  actual?: string;
  error?: string;
};

const results: BenchmarkResult[] = [];

// Track created user IDs for cleanup
const createdUserIds: unknown[] = [];

/**
 * Track a created user ID for cleanup at the end of benchmarks
 */
function trackCreatedUser(id: unknown): void {
  if (id !== undefined && id !== null) {
    createdUserIds.push(id);
  }
}

/**
 * Make an HTTP request and measure response time
 */
async function timedRequest(
  url: string,
  options: RequestInit = {}
): Promise<{ response: Response; duration: number }> {
  const start = performance.now();
  const response = await fetch(url, options);
  const duration = performance.now() - start;
  return { response, duration };
}

/**
 * Record a benchmark result
 */
function recordBenchmark(options: {
  name: string;
  duration: number;
  target?: string;
  actual?: string;
  error?: string;
}): void {
  results.push(options);
}

/**
 * Format duration with color coding
 */
function formatDuration(duration: number, threshold: number): string {
  const color = duration < threshold ? colors.green : colors.yellow;
  return `${color}${Math.round(duration)}ms${colors.reset}`;
}

/**
 * Print a test section header
 */
function printSection(title: string): void {
  console.log(
    `\n${colors.bright}${colors.cyan}${"━".repeat(60)}${colors.reset}`
  );
  console.log(`${colors.bright}${colors.cyan}${title}${colors.reset}`);
  console.log(
    `${colors.bright}${colors.cyan}${"━".repeat(60)}${colors.reset}\n`
  );
}

/**
 * Print benchmark summary
 */
function printSummary(): void {
  const total = results.length;
  const withErrors = results.filter((r) => r.error).length;

  console.log(
    `\n${colors.bright}${colors.cyan}${"━".repeat(60)}${colors.reset}`
  );
  console.log(
    `${colors.bright}${colors.cyan}📊 BENCHMARK SUMMARY${colors.reset}`
  );
  console.log(
    `${colors.bright}${colors.cyan}${"━".repeat(60)}${colors.reset}\n`
  );

  console.log(`Total benchmarks: ${total}`);

  // Show results with errors (if any)
  if (withErrors > 0) {
    console.log(
      `\n${colors.yellow}Benchmarks with errors: ${withErrors}${colors.reset}`
    );
    for (const result of results.filter((r) => r.error)) {
      console.log(
        `  ${colors.yellow}!${colors.reset} ${result.name} (${Math.round(result.duration)}ms)`
      );
      console.log(`    Error: ${result.error}`);
    }
  }

  // Show all results summary
  console.log(`\n${colors.bright}Results:${colors.reset}`);
  for (const result of results) {
    let line = `  ${result.name}: ${Math.round(result.duration)}ms`;
    if (result.target) {
      line += ` (target: ${result.target})`;
    }
    if (result.actual && !result.actual.startsWith("status")) {
      line += ` → ${result.actual}`;
    }
    console.log(line);
  }

  console.log(
    `\n${colors.bright}${colors.green}Benchmarks complete.${colors.reset}\n`
  );

  process.exit(0);
}

/**
 * Benchmark: Cold start performance with cache bypass
 */
async function benchmarkColdStart(): Promise<void> {
  printSection("COLD START BENCHMARKS (X-Cache-Control: no-cache)");

  // Test users table introspection
  const { response: usersRes, duration: usersDuration } = await timedRequest(
    `${API_BASE_URL}/api/users/`,
    {
      headers: { "X-Cache-Control": "no-cache" },
    }
  );

  console.log(
    `GET /api/users/ → ${formatDuration(usersDuration, 1000)} (target: <1000ms)`
  );

  recordBenchmark({
    name: "Cold start: GET /api/users/",
    duration: usersDuration,
    target: "< 1000ms",
    actual: `${Math.round(usersDuration)}ms`,
    error: usersRes.ok ? undefined : `status ${usersRes.status}`,
  });

  // Test products table introspection
  const { response: productsRes, duration: productsDuration } =
    await timedRequest(`${API_BASE_URL}/api/products/`, {
      headers: { "X-Cache-Control": "no-cache" },
    });

  console.log(
    `GET /api/products/ → ${formatDuration(productsDuration, 1000)} (target: <1000ms)`
  );

  recordBenchmark({
    name: "Cold start: GET /api/products/",
    duration: productsDuration,
    target: "< 1000ms",
    actual: `${Math.round(productsDuration)}ms`,
    error: productsRes.ok ? undefined : `status ${productsRes.status}`,
  });

  // Test OpenAPI spec generation
  const { response: openApiRes, duration: openApiDuration } =
    await timedRequest(`${API_BASE_URL}/openapi.json`, {
      headers: { "X-Cache-Control": "no-cache" },
    });

  console.log(
    `GET /openapi.json → ${formatDuration(openApiDuration, 500)} (target: <500ms)`
  );

  recordBenchmark({
    name: "Cold start: GET /openapi.json",
    duration: openApiDuration,
    target: "< 500ms",
    actual: `${Math.round(openApiDuration)}ms`,
    error: openApiRes.ok ? undefined : `status ${openApiRes.status}`,
  });
}

/**
 * Benchmark: Cache hit performance (Cache API - edge cached)
 *
 * With Cache API, cache hits should be significantly faster than KV
 * since data is served from the nearest edge location.
 */
async function benchmarkCacheHits(): Promise<void> {
  printSection("CACHE HIT PERFORMANCE (Cache API)");

  // First, warm up the cache
  await fetch(`${API_BASE_URL}/api/users/`);
  await fetch(`${API_BASE_URL}/api/products/`);
  await fetch(`${API_BASE_URL}/openapi.json`);

  // Small delay to ensure cache is ready
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Test cached users endpoint (3 requests)
  const usersDurations: number[] = [];
  for (let i = 0; i < 3; i++) {
    const { response, duration } = await timedRequest(
      `${API_BASE_URL}/api/users/`
    );
    if (response.ok) {
      usersDurations.push(duration);
    }
  }

  const avgUsersDuration = Math.round(
    usersDurations.reduce((a, b) => a + b, 0) / usersDurations.length
  );

  console.log(
    `GET /api/users/ (avg of 3) → ${formatDuration(avgUsersDuration, 100)} (target: <100ms)`
  );

  recordBenchmark({
    name: "Cache hit: GET /api/users/ average",
    duration: avgUsersDuration,
    target: "< 100ms",
    actual: `${avgUsersDuration}ms`,
  });

  // Test cached products endpoint (3 requests)
  const productsDurations: number[] = [];
  for (let i = 0; i < 3; i++) {
    const { response, duration } = await timedRequest(
      `${API_BASE_URL}/api/products/`
    );
    if (response.ok) {
      productsDurations.push(duration);
    }
  }

  const avgProductsDuration = Math.round(
    productsDurations.reduce((a, b) => a + b, 0) / productsDurations.length
  );

  console.log(
    `GET /api/products/ (avg of 3) → ${formatDuration(avgProductsDuration, 100)} (target: <100ms)`
  );

  recordBenchmark({
    name: "Cache hit: GET /api/products/ average",
    duration: avgProductsDuration,
    target: "< 100ms",
    actual: `${avgProductsDuration}ms`,
  });

  // Test cached OpenAPI spec (3 requests)
  const openApiDurations: number[] = [];
  for (let i = 0; i < 3; i++) {
    const { response, duration } = await timedRequest(
      `${API_BASE_URL}/openapi.json`
    );
    if (response.ok) {
      openApiDurations.push(duration);
    }
  }

  const avgOpenApiDuration = Math.round(
    openApiDurations.reduce((a, b) => a + b, 0) / openApiDurations.length
  );

  console.log(
    `GET /openapi.json (avg of 3) → ${formatDuration(avgOpenApiDuration, 100)} (target: <100ms)`
  );

  recordBenchmark({
    name: "Cache hit: GET /openapi.json average",
    duration: avgOpenApiDuration,
    target: "< 100ms",
    actual: `${avgOpenApiDuration}ms`,
  });
}

/**
 * Helper to measure cache behavior for a query
 */
async function measureQueryCacheBehavior(
  url: string
): Promise<{ coldMs: number; warmMs: number; speedup: number }> {
  // Cold request (first time with these params)
  const { duration: coldMs } = await timedRequest(url, {
    headers: { "X-Cache-Control": "no-cache" },
  });

  // Small delay
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Warm request (should be cached)
  const { duration: warmMs } = await timedRequest(url);

  const speedup = coldMs / warmMs;
  return { coldMs: Math.round(coldMs), warmMs: Math.round(warmMs), speedup };
}

/**
 * Benchmark: Query parameter cache behavior (Cache API)
 *
 * Tests that different query parameter combinations are cached separately
 * in the Cache API with deterministic URL-based keys.
 */
async function benchmarkQueryParamCaching(): Promise<void> {
  printSection("QUERY PARAMETER CACHING (Cache API)");

  // Test filter caching
  const filterResult = await measureQueryCacheBehavior(
    `${API_BASE_URL}/api/users/?is_active=true`
  );
  console.log("Filter: ?is_active=true");
  console.log(
    `  ${colors.blue}→${colors.reset} Cold: ${filterResult.coldMs}ms, Warm: ${filterResult.warmMs}ms, Speedup: ${colors.bright}${filterResult.speedup.toFixed(1)}x${colors.reset} (target: >=1.2x)`
  );
  recordBenchmark({
    name: "Query cache: Filter",
    duration: filterResult.warmMs,
    target: ">= 1.2x speedup",
    actual: `${filterResult.speedup.toFixed(1)}x`,
  });

  // Test sort caching
  const sortResult = await measureQueryCacheBehavior(
    `${API_BASE_URL}/api/users/?order_by=-created_at`
  );
  console.log("Sort: ?order_by=-created_at");
  console.log(
    `  ${colors.blue}→${colors.reset} Cold: ${sortResult.coldMs}ms, Warm: ${sortResult.warmMs}ms, Speedup: ${colors.bright}${sortResult.speedup.toFixed(1)}x${colors.reset} (target: >=1.2x)`
  );
  recordBenchmark({
    name: "Query cache: Sort",
    duration: sortResult.warmMs,
    target: ">= 1.2x speedup",
    actual: `${sortResult.speedup.toFixed(1)}x`,
  });

  // Test pagination caching
  const pageResult = await measureQueryCacheBehavior(
    `${API_BASE_URL}/api/users/?limit=5&offset=0`
  );
  console.log("Pagination: ?limit=5&offset=0");
  console.log(
    `  ${colors.blue}→${colors.reset} Cold: ${pageResult.coldMs}ms, Warm: ${pageResult.warmMs}ms, Speedup: ${colors.bright}${pageResult.speedup.toFixed(1)}x${colors.reset} (target: >=1.2x)`
  );
  recordBenchmark({
    name: "Query cache: Pagination",
    duration: pageResult.warmMs,
    target: ">= 1.2x speedup",
    actual: `${pageResult.speedup.toFixed(1)}x`,
  });

  // Test combined query caching
  const comboResult = await measureQueryCacheBehavior(
    `${API_BASE_URL}/api/users/?is_active=true&order_by=name&limit=10&select=id,name`
  );
  console.log(
    "Combined: ?is_active=true&order_by=name&limit=10&select=id,name"
  );
  console.log(
    `  ${colors.blue}→${colors.reset} Cold: ${comboResult.coldMs}ms, Warm: ${comboResult.warmMs}ms, Speedup: ${colors.bright}${comboResult.speedup.toFixed(1)}x${colors.reset} (target: >=1.2x)`
  );
  recordBenchmark({
    name: "Query cache: Combined query",
    duration: comboResult.warmMs,
    target: ">= 1.2x speedup",
    actual: `${comboResult.speedup.toFixed(1)}x`,
  });

  // Test that different query params are cached separately
  console.log(`\n${colors.cyan}Cache isolation test:${colors.reset}`);

  // Warm up two different queries
  await timedRequest(`${API_BASE_URL}/api/users/?limit=3`);
  await timedRequest(`${API_BASE_URL}/api/users/?limit=5`);
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Both should return correct results (not mixed cache)
  const { response: res3 } = await timedRequest(
    `${API_BASE_URL}/api/users/?limit=3`
  );
  const { response: res5 } = await timedRequest(
    `${API_BASE_URL}/api/users/?limit=5`
  );

  const data3 = (await res3.json()) as unknown[];
  const data5 = (await res5.json()) as unknown[];

  const isolationOk = data3.length <= 3 && data5.length <= 5;
  console.log("Different params cached separately");
  console.log(
    `  ${colors.blue}→${colors.reset} ?limit=3 returned ${data3.length} records, ?limit=5 returned ${data5.length} records`
  );
  recordBenchmark({
    name: "Query cache: Isolation",
    duration: 0,
    target: "different params cached separately",
    actual: isolationOk ? "correctly isolated" : "cache mixing detected",
  });
}

/**
 * Benchmark: Cache speedup analysis (Cache API vs Cold)
 *
 * Measures the performance improvement from Cache API edge caching.
 * With Cache API, expect 5-20x speedup compared to database queries.
 */
async function benchmarkCacheSpeedup(): Promise<void> {
  printSection("CACHE SPEEDUP ANALYSIS (Cache API)");

  // Cold start
  const { duration: coldDuration } = await timedRequest(
    `${API_BASE_URL}/api/users/`,
    {
      headers: { "X-Cache-Control": "no-cache" },
    }
  );

  // Small delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Warm (cached)
  const { duration: warmDuration } = await timedRequest(
    `${API_BASE_URL}/api/users/`
  );

  const speedup = coldDuration / warmDuration;

  console.log(`Cold start (DB query): ${Math.round(coldDuration)}ms`);
  console.log(`Cache hit (Cache API): ${Math.round(warmDuration)}ms`);
  console.log(
    `Speedup: ${colors.bright}${speedup.toFixed(1)}x${colors.reset} (target: >=2.0x)`
  );

  recordBenchmark({
    name: "Cache speedup ratio (Cache API)",
    duration: warmDuration,
    target: ">= 2.0x",
    actual: `${speedup.toFixed(1)}x`,
  });
}

/**
 * Benchmark: CRUD operations
 */
async function benchmarkCrudOperations(): Promise<void> {
  printSection("CRUD OPERATIONS");

  // GET (list all users)
  const { response: getRes, duration: getDuration } = await timedRequest(
    `${API_BASE_URL}/api/users/`
  );

  console.log(
    `GET /api/users/ → ${formatDuration(getDuration, 50)} (status: ${getRes.status})`
  );

  recordBenchmark({
    name: "CRUD: GET /api/users/",
    duration: getDuration,
    actual: `status ${getRes.status}`,
    error: getRes.ok ? undefined : `status ${getRes.status}`,
  });

  if (getRes.ok) {
    const users = (await getRes.json()) as unknown[];
    console.log(
      `  ${colors.blue}→${colors.reset} Retrieved ${users.length} users`
    );
  }

  // POST (create new user)
  const testUser = {
    name: `Test User ${Date.now()}`,
    email: `test${Date.now()}@example.com`,
    is_active: true,
  };

  const { response: postRes, duration: postDuration } = await timedRequest(
    `${API_BASE_URL}/api/users/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testUser),
    }
  );

  console.log(
    `POST /api/users/ → ${formatDuration(postDuration, 50)} (status: ${postRes.status})`
  );

  recordBenchmark({
    name: "CRUD: POST /api/users/",
    duration: postDuration,
    actual: `status ${postRes.status}`,
    error: postRes.ok ? undefined : await postRes.text(),
  });

  if (postRes.ok) {
    const created = (await postRes.json()) as Record<string, unknown>;
    trackCreatedUser(created.id);
    console.log(
      `  ${colors.blue}→${colors.reset} Created user: ${created.name}`
    );
  }
}

/**
 * Helper to run a single GET query benchmark
 */
async function runGetQueryBenchmark(
  name: string,
  url: string,
  logExtra?: (data: unknown) => string
): Promise<void> {
  const { response, duration } = await timedRequest(url);
  console.log(
    `GET ${url.replace(API_BASE_URL ?? "", "")} → ${formatDuration(duration, 300)} (status: ${response.status})`
  );
  if (response.ok && logExtra) {
    const data = await response.json();
    console.log(`  ${colors.blue}→${colors.reset} ${logExtra(data)}`);
  }
  recordBenchmark({
    name,
    duration,
    actual: `status ${response.status}`,
    error: response.ok ? undefined : `status ${response.status}`,
  });
}

/**
 * Benchmark: GET query parameters (filtering, sorting, pagination, field selection)
 */
async function benchmarkGetQueryParams(): Promise<void> {
  printSection("GET QUERY PARAMETERS");

  // Filter by equality
  await runGetQueryBenchmark(
    "Query: Filter by equality",
    `${API_BASE_URL}/api/users/?is_active=true`,
    (data) => `Filtered to ${(data as unknown[]).length} active users`
  );

  // Sorting (ORDER BY)
  await runGetQueryBenchmark(
    "Query: Sorting (ORDER BY)",
    `${API_BASE_URL}/api/users/?order_by=-created_at,name`
  );

  // Pagination (LIMIT/OFFSET)
  await runGetQueryBenchmark(
    "Query: Pagination (LIMIT/OFFSET)",
    `${API_BASE_URL}/api/users/?limit=5&offset=0`,
    (data) => `Retrieved ${(data as unknown[]).length} users (limit 5)`
  );

  // Field selection (SELECT)
  await runGetQueryBenchmark(
    "Query: Field selection (SELECT)",
    `${API_BASE_URL}/api/users/?select=id,name,email`,
    (data) => {
      const arr = data as Record<string, unknown>[];
      if (arr.length > 0) {
        return `Returned fields: ${Object.keys(arr[0]).join(", ")}`;
      }
      return "No records returned";
    }
  );

  // Combined query (filter + sort + limit + select)
  await runGetQueryBenchmark(
    "Query: Combined filter+sort+limit+select",
    `${API_BASE_URL}/api/users/?is_active=true&order_by=-created_at&limit=3&select=id,name`,
    (data) => `Combined query returned ${(data as unknown[]).length} users`
  );
}

/**
 * Benchmark: POST query parameters (returning, on_conflict)
 *
 * Note: ON CONFLICT tests require a UNIQUE constraint on the target column.
 * If these tests fail with 500 errors, ensure your table has:
 *   ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
 */
async function benchmarkPostQueryParams(): Promise<void> {
  printSection("POST QUERY PARAMETERS (UPSERT)");
  console.log(
    `${colors.yellow}Note: ON CONFLICT tests require UNIQUE constraint on email column${colors.reset}\n`
  );

  const timestamp = Date.now();

  // POST with returning param (selective RETURNING)
  const testUser1 = {
    name: `Benchmark User ${timestamp}`,
    email: `benchmark-returning-${timestamp}@example.com`,
    is_active: true,
  };

  const { response: retRes, duration: retDuration } = await timedRequest(
    `${API_BASE_URL}/api/users/?returning=id,name,email`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testUser1),
    }
  );
  console.log(
    `POST /api/users/?returning=id,name,email → ${formatDuration(retDuration, 500)} (status: ${retRes.status})`
  );
  if (retRes.ok) {
    const data = (await retRes.json()) as Record<string, unknown>;
    trackCreatedUser(data.id);
    const fields = Object.keys(data);
    console.log(
      `  ${colors.blue}→${colors.reset} Returned fields: ${fields.join(", ")}`
    );
  }
  recordBenchmark({
    name: "POST: Selective RETURNING",
    duration: retDuration,
    actual: `status ${retRes.status}`,
    error: retRes.ok ? undefined : await retRes.clone().text(),
  });

  // POST with on_conflict DO NOTHING (upsert - skip duplicate)
  const testUser2 = {
    name: `Benchmark Upsert ${timestamp}`,
    email: `benchmark-upsert-${timestamp}@example.com`,
    is_active: true,
  };

  // First insert
  const { response: firstInsertRes } = await timedRequest(
    `${API_BASE_URL}/api/users/?returning=id`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testUser2),
    }
  );
  if (firstInsertRes.ok) {
    const data = (await firstInsertRes.json()) as Record<string, unknown>;
    trackCreatedUser(data.id);
  }

  // Second insert with same email (should be skipped)
  const { response: nothingRes, duration: nothingDuration } =
    await timedRequest(
      `${API_BASE_URL}/api/users/?on_conflict=email&on_conflict_action=nothing`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...testUser2,
          name: "Should Not Update",
        }),
      }
    );
  // 204 No Content indicates conflict was detected, no insert performed
  console.log(
    `POST /api/users/?on_conflict=email&on_conflict_action=nothing → ${formatDuration(nothingDuration, 500)} (status: ${nothingRes.status})`
  );
  if (nothingRes.status === 204) {
    console.log(
      `  ${colors.blue}→${colors.reset} Conflict handled: 204 No Content (no insert performed)`
    );
  }
  recordBenchmark({
    name: "POST: ON CONFLICT DO NOTHING",
    duration: nothingDuration,
    actual: `status ${nothingRes.status}`,
    error:
      nothingRes.status === 204 ? undefined : await nothingRes.clone().text(),
  });

  // POST with on_conflict DO UPDATE (upsert - update on duplicate)
  const testUser3 = {
    name: `Benchmark Update ${timestamp}`,
    email: `benchmark-update-${timestamp}@example.com`,
    is_active: true,
  };

  // First insert
  const { response: firstInsertRes3 } = await timedRequest(
    `${API_BASE_URL}/api/users/?returning=id`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testUser3),
    }
  );
  if (firstInsertRes3.ok) {
    const data = (await firstInsertRes3.json()) as Record<string, unknown>;
    trackCreatedUser(data.id);
  }

  // Second insert with same email (should update name)
  const { response: updateRes, duration: updateDuration } = await timedRequest(
    `${API_BASE_URL}/api/users/?on_conflict=email&on_conflict_update=name&returning=id,name,email`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...testUser3,
        name: "Updated Name via Upsert",
      }),
    }
  );
  console.log(
    `POST /api/users/?on_conflict=email&on_conflict_update=name → ${formatDuration(updateDuration, 500)} (status: ${updateRes.status})`
  );
  if (updateRes.ok) {
    const data = (await updateRes.json()) as Record<string, unknown>;
    console.log(
      `  ${colors.blue}→${colors.reset} Upserted user: ${data.name ?? "(no name returned)"}`
    );
  }
  recordBenchmark({
    name: "POST: ON CONFLICT DO UPDATE",
    duration: updateDuration,
    actual: `status ${updateRes.status}`,
    error: updateRes.ok ? undefined : await updateRes.clone().text(),
  });
}

/**
 * Helper: Create a test user for DELETE benchmarks
 */
async function createDeleteTestUser(
  userData: Record<string, unknown>
): Promise<{ id: unknown } | null> {
  const { response } = await timedRequest(`${API_BASE_URL}/api/users/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(userData),
  });

  if (!response.ok) {
    return null;
  }

  const user = (await response.json()) as { id: unknown };
  trackCreatedUser(user.id);
  return user;
}

/**
 * Helper: Run DELETE by ID benchmark
 */
async function benchmarkDeleteById(
  userId: unknown,
  withReturning: boolean
): Promise<void> {
  const url = withReturning
    ? `${API_BASE_URL}/api/users/${userId}?returning=id,name,email`
    : `${API_BASE_URL}/api/users/${userId}`;

  const { response, duration } = await timedRequest(url, { method: "DELETE" });

  const label = withReturning ? "with returning" : "(default returning)";
  console.log(
    `DELETE /api/users/${userId}${withReturning ? "?returning=..." : ""} ${label} → ${formatDuration(duration, 500)} (status: ${response.status})`
  );

  if (response.ok && withReturning) {
    const deleted = (await response.json()) as Record<string, unknown>;
    console.log(
      `  ${colors.blue}→${colors.reset} Deleted user: ${deleted.name}`
    );
  }

  recordBenchmark({
    name: `DELETE: Single record by ID ${label}`,
    duration,
    actual: `status ${response.status}`,
    error: response.ok ? undefined : await response.clone().text(),
  });
}

/**
 * Helper: Run bulk DELETE benchmark
 */
async function benchmarkBulkDelete(timestamp: number): Promise<void> {
  // Create test users for bulk delete
  const bulkTestUsers = [
    {
      name: `Bulk Delete Test 1 ${timestamp}`,
      email: `bulk-delete-1-${timestamp}@example.com`,
      is_active: false,
    },
    {
      name: `Bulk Delete Test 2 ${timestamp}`,
      email: `bulk-delete-2-${timestamp}@example.com`,
      is_active: false,
    },
  ];

  for (const user of bulkTestUsers) {
    await createDeleteTestUser(user);
  }

  const { response, duration } = await timedRequest(
    `${API_BASE_URL}/api/users/?email__ilike=%bulk-delete%${timestamp}%&returning=id,email`,
    { method: "DELETE" }
  );

  // With returning param, expect 200 with JSON body
  console.log(
    `DELETE /api/users/?email__ilike=%bulk-delete%${timestamp}%&returning=id,email → ${formatDuration(duration, 500)} (status: ${response.status})`
  );

  if (response.status === 200) {
    const deletedRecords = (await response.json()) as unknown[];
    console.log(
      `  ${colors.blue}→${colors.reset} Deleted ${deletedRecords.length} records`
    );
  }

  recordBenchmark({
    name: "DELETE: Bulk delete with filter and returning",
    duration,
    actual: `status ${response.status}`,
    error: response.ok ? undefined : await response.clone().text(),
  });

  // Also test bulk delete without returning (should get 204)
  // Create another user for this test
  await createDeleteTestUser({
    name: `Bulk Delete NoReturn ${timestamp}`,
    email: `bulk-delete-noreturn-${timestamp}@example.com`,
    is_active: false,
  });

  const { response: noReturnRes, duration: noReturnDuration } =
    await timedRequest(
      `${API_BASE_URL}/api/users/?email__ilike=%bulk-delete-noreturn%${timestamp}%`,
      { method: "DELETE" }
    );

  // Without returning param, expect 204 No Content
  console.log(
    `DELETE /api/users/?email__ilike=... (no returning) → ${formatDuration(noReturnDuration, 500)} (status: ${noReturnRes.status})`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} Returned ${noReturnRes.status} (no returning param)`
  );

  recordBenchmark({
    name: "DELETE: Bulk delete without returning (204)",
    duration: noReturnDuration,
    actual: `status ${noReturnRes.status}`,
  });
}

/**
 * Helper: Run DELETE edge case benchmarks (no match, not found)
 */
async function benchmarkDeleteEdgeCases(): Promise<void> {
  // DELETE with no matching records (should return 204)
  const { response: deleteNoneRes, duration: deleteNoneDuration } =
    await timedRequest(`${API_BASE_URL}/api/users/?id=-999999`, {
      method: "DELETE",
    });

  console.log(
    `DELETE /api/users/?id=-999999 (no match) → ${formatDuration(deleteNoneDuration, 500)} (status: ${deleteNoneRes.status})`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} Returned ${deleteNoneRes.status} (no records matched)`
  );

  recordBenchmark({
    name: "DELETE: No matching records (204)",
    duration: deleteNoneDuration,
    actual: `status ${deleteNoneRes.status}`,
  });

  // DELETE by non-existent ID (should return 404)
  const { response: deleteNotFoundRes, duration: deleteNotFoundDuration } =
    await timedRequest(`${API_BASE_URL}/api/users/-999999`, {
      method: "DELETE",
    });

  console.log(
    `DELETE /api/users/-999999 (not found) → ${formatDuration(deleteNotFoundDuration, 500)} (status: ${deleteNotFoundRes.status})`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} Returned ${deleteNotFoundRes.status}`
  );

  recordBenchmark({
    name: "DELETE: Record not found (404)",
    duration: deleteNotFoundDuration,
    actual: `status ${deleteNotFoundRes.status}`,
  });
}

/**
 * Benchmark: DELETE operations
 *
 * Tests DELETE endpoint functionality including:
 * - Delete by ID with returning
 * - Bulk delete with filters
 * - Delete with no matching records (204)
 */
async function benchmarkDeleteOperations(): Promise<void> {
  printSection("DELETE OPERATIONS");

  const timestamp = Date.now();

  // Create test users
  const user1 = await createDeleteTestUser({
    name: `Delete Test Single ${timestamp}`,
    email: `delete-single-${timestamp}@example.com`,
    is_active: true,
  });

  if (!user1) {
    console.log(
      `${colors.yellow}!${colors.reset} Could not create test user for DELETE benchmark`
    );
    recordBenchmark({
      name: "DELETE: Setup failed",
      duration: 0,
      error: "Could not create test user 1",
    });
    return;
  }

  const user2 = await createDeleteTestUser({
    name: `Delete Test Bulk ${timestamp}`,
    email: `delete-bulk-${timestamp}@example.com`,
    is_active: false,
  });

  if (!user2) {
    console.log(
      `${colors.yellow}!${colors.reset} Could not create second test user for DELETE benchmark`
    );
    recordBenchmark({
      name: "DELETE: Setup failed",
      duration: 0,
      error: "Could not create test user 2",
    });
    return;
  }

  // Run benchmarks
  await benchmarkDeleteById(user1.id, true);
  await benchmarkDeleteById(user2.id, false);
  await benchmarkBulkDelete(timestamp);
  await benchmarkDeleteEdgeCases();
}

/**
 * Helper: Create a test user for UPDATE benchmarks
 */
async function createUpdateTestUser(
  userData: Record<string, unknown>
): Promise<{ id: unknown } | null> {
  const { response } = await timedRequest(`${API_BASE_URL}/api/users/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(userData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.log(
      `  ${colors.red}→${colors.reset} Failed to create test user: ${response.status} - ${errorText}`
    );
    return null;
  }

  const user = (await response.json()) as { id: unknown };
  trackCreatedUser(user.id);
  return user;
}

/**
 * Helper: Benchmark PUT by ID with returning
 */
async function benchmarkPutById(
  userId: unknown,
  timestamp: number
): Promise<void> {
  const { response, duration } = await timedRequest(
    `${API_BASE_URL}/api/users/${userId}?returning=id,name,email`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Updated via PUT ${timestamp}`,
        email: `updated-put-${timestamp}@example.com`,
        is_active: false,
      }),
    }
  );

  console.log(
    `PUT /api/users/${userId}?returning=id,name,email → ${formatDuration(duration, 500)} (status: ${response.status})`
  );
  if (response.ok) {
    const updated = (await response.json()) as Record<string, unknown>;
    console.log(
      `  ${colors.blue}→${colors.reset} Updated user: ${updated.name}`
    );
  }
  recordBenchmark({
    name: "PUT: Full replacement by ID with returning",
    duration,
    actual: `status ${response.status}`,
    error: response.ok ? undefined : await response.clone().text(),
  });
}

/**
 * Helper: Benchmark PATCH by ID with returning
 */
async function benchmarkPatchById(
  userId: unknown,
  timestamp: number
): Promise<void> {
  const { response, duration } = await timedRequest(
    `${API_BASE_URL}/api/users/${userId}?returning=id,name`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Updated via PATCH ${timestamp}`,
      }),
    }
  );

  console.log(
    `PATCH /api/users/${userId}?returning=id,name → ${formatDuration(duration, 500)} (status: ${response.status})`
  );
  if (response.ok) {
    const updated = (await response.json()) as Record<string, unknown>;
    console.log(
      `  ${colors.blue}→${colors.reset} Updated user: ${updated.name}`
    );
  }
  recordBenchmark({
    name: "PATCH: Partial update by ID with returning",
    duration,
    actual: `status ${response.status}`,
    error: response.ok ? undefined : await response.clone().text(),
  });
}

/**
 * Helper: Benchmark PATCH by ID without returning
 */
async function benchmarkPatchByIdNoReturning(userId: unknown): Promise<void> {
  const { response, duration } = await timedRequest(
    `${API_BASE_URL}/api/users/${userId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: true }),
    }
  );

  console.log(
    `PATCH /api/users/${userId} (no returning) → ${formatDuration(duration, 500)} (status: ${response.status})`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} Returned ${response.status} (no returning param)`
  );
  recordBenchmark({
    name: "PATCH: Partial update by ID without returning",
    duration,
    actual: `status ${response.status}`,
  });
}

/**
 * Helper: Benchmark bulk PATCH with filters
 */
async function benchmarkBulkPatch(timestamp: number): Promise<void> {
  await createUpdateTestUser({
    name: `Bulk Patch User 1 ${timestamp}`,
    email: `bulk-patch-1-${timestamp}@example.com`,
    is_active: false,
  });
  await createUpdateTestUser({
    name: `Bulk Patch User 2 ${timestamp}`,
    email: `bulk-patch-2-${timestamp}@example.com`,
    is_active: false,
  });

  const { response, duration } = await timedRequest(
    `${API_BASE_URL}/api/users/?email__ilike=%bulk-patch-%-${timestamp}%&returning=id,name,is_active`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: true }),
    }
  );

  console.log(
    `PATCH /api/users/?email__ilike=...&returning=... → ${formatDuration(duration, 500)} (status: ${response.status})`
  );
  if (response.status === 200) {
    const updated = (await response.json()) as unknown[];
    console.log(
      `  ${colors.blue}→${colors.reset} Updated ${updated.length} records`
    );
  } else if (response.status === 204) {
    console.log(
      `  ${colors.blue}→${colors.reset} Returned 204 No Content (no records matched or no returning)`
    );
  }
  recordBenchmark({
    name: "PATCH: Bulk partial update with filter",
    duration,
    actual: `status ${response.status}`,
    error: response.ok ? undefined : await response.clone().text(),
  });
}

/**
 * Helper: Benchmark PUT validation (missing required fields)
 */
async function benchmarkPutValidation(userId: unknown): Promise<void> {
  const { response, duration } = await timedRequest(
    `${API_BASE_URL}/api/users/${userId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Only Name" }),
    }
  );

  console.log(
    `PUT /api/users/${userId} (missing required fields) → ${formatDuration(duration, 500)} (status: ${response.status})`
  );
  if (response.status === 400) {
    const error = (await response.json()) as Record<string, unknown>;
    console.log(
      `  ${colors.blue}→${colors.reset} Returned 400: ${error.error}`
    );
  }
  recordBenchmark({
    name: "PUT: Missing required fields (400)",
    duration,
    actual: `status ${response.status}`,
  });
}

/**
 * Helper: Benchmark PATCH not found
 */
async function benchmarkPatchNotFound(): Promise<void> {
  const { response, duration } = await timedRequest(
    `${API_BASE_URL}/api/users/-999999`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Does Not Exist" }),
    }
  );

  console.log(
    `PATCH /api/users/-999999 (not found) → ${formatDuration(duration, 500)} (status: ${response.status})`
  );
  console.log(`  ${colors.blue}→${colors.reset} Returned ${response.status}`);
  recordBenchmark({
    name: "PATCH: Record not found (404)",
    duration,
    actual: `status ${response.status}`,
  });
}

/**
 * Benchmark: UPDATE (PUT/PATCH) operations
 */
async function benchmarkUpdateOperations(): Promise<void> {
  printSection("UPDATE (PUT/PATCH) OPERATIONS");

  const timestamp = Date.now();

  const user1 = await createUpdateTestUser({
    name: `Update Test PUT ${timestamp}`,
    email: `update-put-${timestamp}@example.com`,
    is_active: true,
  });
  const user2 = await createUpdateTestUser({
    name: `Update Test PATCH ${timestamp}`,
    email: `update-patch-${timestamp}@example.com`,
    is_active: true,
  });
  const user3 = await createUpdateTestUser({
    name: `Update Test Bulk ${timestamp}`,
    email: `update-bulk-${timestamp}@example.com`,
    is_active: false,
  });

  if (!(user1 && user2 && user3)) {
    console.log(
      `${colors.yellow}!${colors.reset} Could not create test users for UPDATE benchmark`
    );
    recordBenchmark({
      name: "UPDATE: Setup failed",
      duration: 0,
      error: "Could not create test users",
    });
    return;
  }

  await benchmarkPutById(user1.id, timestamp);
  await benchmarkPatchById(user2.id, timestamp);
  await benchmarkPatchByIdNoReturning(user3.id);
  await benchmarkBulkPatch(timestamp);
  await benchmarkPutValidation(user1.id);
  await benchmarkPatchNotFound();

  await timedRequest(`${API_BASE_URL}/api/users/?email__ilike=%${timestamp}%`, {
    method: "DELETE",
  });
}

/**
 * Benchmark: Concurrent load
 */
async function benchmarkConcurrentLoad(): Promise<void> {
  printSection("CONCURRENT LOAD BENCHMARK");

  // 10 parallel requests
  const promises = Array.from({ length: 10 }, () =>
    timedRequest(`${API_BASE_URL}/api/users/`)
  );

  const start = performance.now();
  const responses = await Promise.all(promises);
  const totalDuration = performance.now() - start;

  const allOk = responses.every((r) => r.response.ok);
  const avgDuration = Math.round(
    responses.reduce((sum, r) => sum + r.duration, 0) / responses.length
  );

  console.log("10 parallel requests");
  console.log(
    `  ${colors.blue}→${colors.reset} Total time: ${Math.round(totalDuration)}ms`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} Average per request: ${avgDuration}ms (target: <600ms)`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} All succeeded: ${allOk ? "Yes" : "No"}`
  );

  recordBenchmark({
    name: "Concurrent: 10 parallel requests",
    duration: totalDuration,
    actual: allOk ? "all success" : "some failed",
  });

  recordBenchmark({
    name: "Concurrent: Average response time",
    duration: avgDuration,
    target: "< 600ms",
    actual: `${avgDuration}ms`,
  });
}

/**
 * Warm up the database to avoid Neon autosuspend penalty
 * On Neon free tier, databases suspend after 5 minutes of inactivity
 */
async function warmupDatabase(): Promise<void> {
  console.log(
    `${colors.bright}${colors.yellow}⏳ Warming up database (Neon free tier has 5min autosuspend)...${colors.reset}`
  );

  try {
    const { duration } = await timedRequest(`${API_BASE_URL}/api/users/`);

    if (duration > 1000) {
      console.log(
        `${colors.yellow}   Database was suspended. Wake-up took ${Math.round(duration)}ms${colors.reset}`
      );
      console.log(
        `${colors.yellow}   Waiting 2 seconds for database to stabilize...${colors.reset}\n`
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } else {
      console.log(
        `${colors.green}   Database already warm (${Math.round(duration)}ms)${colors.reset}\n`
      );
    }
  } catch {
    console.log(
      `${colors.yellow}   Warning: Warm-up request failed, continuing anyway...${colors.reset}\n`
    );
  }
}

/**
 * Clean up all test data created during benchmarks
 */
async function cleanupTestData(): Promise<void> {
  if (createdUserIds.length === 0) {
    return;
  }

  console.log(
    `\n${colors.bright}${colors.yellow}🧹 Cleaning up ${createdUserIds.length} test records...${colors.reset}`
  );

  let deleted = 0;
  for (const id of createdUserIds) {
    try {
      const { response } = await timedRequest(
        `${API_BASE_URL}/api/users/${id}`,
        { method: "DELETE" }
      );
      if (response.ok || response.status === 404) {
        deleted += 1;
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  console.log(
    `${colors.green}   Cleaned up ${deleted}/${createdUserIds.length} records${colors.reset}\n`
  );
}

/**
 * Main benchmark runner
 */
async function main(): Promise<void> {
  console.log(
    `${colors.bright}${colors.cyan}🧪 Elekk Performance Benchmarks${colors.reset}`
  );
  console.log(
    `${colors.bright}${colors.cyan}🌐 Benchmarking: ${colors.reset}${API_BASE_URL}\n`
  );

  try {
    await warmupDatabase();
    await benchmarkColdStart();
    await benchmarkCacheHits();
    await benchmarkQueryParamCaching();
    await benchmarkCacheSpeedup();
    await benchmarkCrudOperations();
    await benchmarkGetQueryParams();
    await benchmarkPostQueryParams();
    await benchmarkDeleteOperations();
    await benchmarkUpdateOperations();
    await benchmarkConcurrentLoad();
  } catch (error) {
    console.error(
      `\n${colors.red}Fatal error during benchmarks:${colors.reset}`,
      error
    );
    await cleanupTestData();
    process.exit(1);
  }

  await cleanupTestData();
  printSummary();
}

main();
