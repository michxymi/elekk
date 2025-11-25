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
  passed: boolean;
  duration: number;
  expected?: string;
  actual?: string;
  error?: string;
};

const results: BenchmarkResult[] = [];

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
  passed: boolean;
  duration: number;
  expected?: string;
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
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

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
  console.log(`${colors.green}✓ Passed: ${passed}${colors.reset}`);

  if (failed > 0) {
    console.log(`${colors.red}✗ Failed: ${failed}${colors.reset}\n`);
    console.log(`${colors.red}Failed benchmarks:${colors.reset}`);
    for (const result of results.filter((r) => !r.passed)) {
      console.log(
        `  ${colors.red}✗${colors.reset} ${result.name} (${Math.round(result.duration)}ms)`
      );
      if (result.expected && result.actual) {
        console.log(
          `    Expected: ${result.expected}, Actual: ${result.actual}`
        );
      }
      if (result.error) {
        console.log(`    Error: ${result.error}`);
      }
    }
  }

  console.log(
    `\n${colors.bright}Overall: ${failed === 0 ? `${colors.green}ALL BENCHMARKS PASSED ✓` : `${colors.red}SOME BENCHMARKS FAILED ✗`}${colors.reset}\n`
  );

  process.exit(failed > 0 ? 1 : 0);
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

  const usersOk = usersRes.ok && usersDuration < 1000;
  console.log(
    `${usersOk ? `${colors.green}✓` : `${colors.red}✗`}${colors.reset} GET /api/users/ → ${formatDuration(usersDuration, 1000)} ${usersDuration < 1000 ? "✓" : "(slower than expected)"}`
  );

  recordBenchmark({
    name: "Cold start: GET /api/users/",
    passed: usersOk,
    duration: usersDuration,
    expected: "< 1000ms",
    actual: `${Math.round(usersDuration)}ms`,
  });

  // Test products table introspection
  const { response: productsRes, duration: productsDuration } =
    await timedRequest(`${API_BASE_URL}/api/products/`, {
      headers: { "X-Cache-Control": "no-cache" },
    });

  const productsOk = productsRes.ok && productsDuration < 1000;
  console.log(
    `${productsOk ? `${colors.green}✓` : `${colors.red}✗`}${colors.reset} GET /api/products/ → ${formatDuration(productsDuration, 1000)} ${productsDuration < 1000 ? "✓" : "(slower than expected)"}`
  );

  recordBenchmark({
    name: "Cold start: GET /api/products/",
    passed: productsOk,
    duration: productsDuration,
    expected: "< 1000ms",
    actual: `${Math.round(productsDuration)}ms`,
  });

  // Test OpenAPI spec generation
  const { response: openApiRes, duration: openApiDuration } =
    await timedRequest(`${API_BASE_URL}/openapi.json`, {
      headers: { "X-Cache-Control": "no-cache" },
    });

  const openApiOk = openApiRes.ok && openApiDuration < 500;
  console.log(
    `${openApiOk ? `${colors.green}✓` : `${colors.red}✗`}${colors.reset} GET /openapi.json → ${formatDuration(openApiDuration, 500)} ${openApiDuration < 500 ? "✓" : "(slower than expected)"}`
  );

  recordBenchmark({
    name: "Cold start: GET /openapi.json",
    passed: openApiOk,
    duration: openApiDuration,
    expected: "< 500ms",
    actual: `${Math.round(openApiDuration)}ms`,
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
  const usersOk = avgUsersDuration < 100;

  console.log(
    `${usersOk ? `${colors.green}✓` : `${colors.yellow}⚠`}${colors.reset} GET /api/users/ (avg of 3) → ${formatDuration(avgUsersDuration, 100)} ${usersOk ? "✓" : "(slower than target)"}`
  );

  recordBenchmark({
    name: "Cache hit: GET /api/users/ average",
    passed: usersOk,
    duration: avgUsersDuration,
    expected: "< 100ms",
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
  const productsOk = avgProductsDuration < 100;

  console.log(
    `${productsOk ? `${colors.green}✓` : `${colors.yellow}⚠`}${colors.reset} GET /api/products/ (avg of 3) → ${formatDuration(avgProductsDuration, 100)} ${productsOk ? "✓" : "(slower than target)"}`
  );

  recordBenchmark({
    name: "Cache hit: GET /api/products/ average",
    passed: productsOk,
    duration: avgProductsDuration,
    expected: "< 100ms",
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
  const openApiOk = avgOpenApiDuration < 100;

  console.log(
    `${openApiOk ? `${colors.green}✓` : `${colors.yellow}⚠`}${colors.reset} GET /openapi.json (avg of 3) → ${formatDuration(avgOpenApiDuration, 100)} ${openApiOk ? "✓" : "(slower than target)"}`
  );

  recordBenchmark({
    name: "Cache hit: GET /openapi.json average",
    passed: openApiOk,
    duration: avgOpenApiDuration,
    expected: "< 100ms",
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
  const filterOk = filterResult.speedup >= 1.2;
  console.log(
    `${filterOk ? `${colors.green}✓` : `${colors.yellow}⚠`}${colors.reset} Filter: ?is_active=true`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} Cold: ${filterResult.coldMs}ms, Warm: ${filterResult.warmMs}ms, Speedup: ${colors.bright}${filterResult.speedup.toFixed(1)}x${colors.reset}`
  );
  recordBenchmark({
    name: "Query cache: Filter",
    passed: filterOk,
    duration: filterResult.warmMs,
    expected: ">= 1.2x speedup",
    actual: `${filterResult.speedup.toFixed(1)}x`,
  });

  // Test sort caching
  const sortResult = await measureQueryCacheBehavior(
    `${API_BASE_URL}/api/users/?order_by=-created_at`
  );
  const sortOk = sortResult.speedup >= 1.2;
  console.log(
    `${sortOk ? `${colors.green}✓` : `${colors.yellow}⚠`}${colors.reset} Sort: ?order_by=-created_at`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} Cold: ${sortResult.coldMs}ms, Warm: ${sortResult.warmMs}ms, Speedup: ${colors.bright}${sortResult.speedup.toFixed(1)}x${colors.reset}`
  );
  recordBenchmark({
    name: "Query cache: Sort",
    passed: sortOk,
    duration: sortResult.warmMs,
    expected: ">= 1.2x speedup",
    actual: `${sortResult.speedup.toFixed(1)}x`,
  });

  // Test pagination caching
  const pageResult = await measureQueryCacheBehavior(
    `${API_BASE_URL}/api/users/?limit=5&offset=0`
  );
  const pageOk = pageResult.speedup >= 1.2;
  console.log(
    `${pageOk ? `${colors.green}✓` : `${colors.yellow}⚠`}${colors.reset} Pagination: ?limit=5&offset=0`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} Cold: ${pageResult.coldMs}ms, Warm: ${pageResult.warmMs}ms, Speedup: ${colors.bright}${pageResult.speedup.toFixed(1)}x${colors.reset}`
  );
  recordBenchmark({
    name: "Query cache: Pagination",
    passed: pageOk,
    duration: pageResult.warmMs,
    expected: ">= 1.2x speedup",
    actual: `${pageResult.speedup.toFixed(1)}x`,
  });

  // Test combined query caching
  const comboResult = await measureQueryCacheBehavior(
    `${API_BASE_URL}/api/users/?is_active=true&order_by=name&limit=10&select=id,name`
  );
  const comboOk = comboResult.speedup >= 1.2;
  console.log(
    `${comboOk ? `${colors.green}✓` : `${colors.yellow}⚠`}${colors.reset} Combined: ?is_active=true&order_by=name&limit=10&select=id,name`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} Cold: ${comboResult.coldMs}ms, Warm: ${comboResult.warmMs}ms, Speedup: ${colors.bright}${comboResult.speedup.toFixed(1)}x${colors.reset}`
  );
  recordBenchmark({
    name: "Query cache: Combined query",
    passed: comboOk,
    duration: comboResult.warmMs,
    expected: ">= 1.2x speedup",
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
  console.log(
    `${isolationOk ? `${colors.green}✓` : `${colors.red}✗`}${colors.reset} Different params cached separately`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} ?limit=3 returned ${data3.length} records, ?limit=5 returned ${data5.length} records`
  );
  recordBenchmark({
    name: "Query cache: Isolation",
    passed: isolationOk,
    duration: 0,
    expected: "different params cached separately",
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
  const speedupOk = speedup >= 2.0;

  console.log(`Cold start (DB query): ${Math.round(coldDuration)}ms`);
  console.log(`Cache hit (Cache API): ${Math.round(warmDuration)}ms`);
  console.log(
    `${speedupOk ? `${colors.green}✓` : `${colors.yellow}⚠`}${colors.reset} Speedup: ${colors.bright}${speedup.toFixed(1)}x${colors.reset} ${speedupOk ? "✓" : "(below 2.0x target)"}`
  );

  recordBenchmark({
    name: "Cache speedup ratio (Cache API)",
    passed: speedupOk,
    duration: warmDuration,
    expected: ">= 2.0x",
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

  const getOk = getRes.ok;
  console.log(
    `${getOk ? `${colors.green}✓` : `${colors.red}✗`}${colors.reset} GET /api/users/ → ${formatDuration(getDuration, 50)} ${getOk ? "✓" : "✗"}`
  );

  recordBenchmark({
    name: "CRUD: GET /api/users/",
    passed: getOk,
    duration: getDuration,
    expected: "status 200",
    actual: `status ${getRes.status}`,
  });

  if (getOk) {
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

  const postOk = postRes.ok;
  console.log(
    `${postOk ? `${colors.green}✓` : `${colors.red}✗`}${colors.reset} POST /api/users/ → ${formatDuration(postDuration, 50)} ${postOk ? "✓" : "✗"}`
  );

  recordBenchmark({
    name: "CRUD: POST /api/users/",
    passed: postOk,
    duration: postDuration,
    expected: "status 200",
    actual: `status ${postRes.status}`,
    error: postOk ? undefined : await postRes.text(),
  });

  if (postOk) {
    const created = (await postRes.json()) as Record<string, unknown>;
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
  const ok = response.ok;
  console.log(
    `${ok ? `${colors.green}✓` : `${colors.red}✗`}${colors.reset} GET ${url.replace(API_BASE_URL ?? "", "")} → ${formatDuration(duration, 300)} ${ok ? "✓" : "✗"}`
  );
  if (ok && logExtra) {
    const data = await response.json();
    console.log(`  ${colors.blue}→${colors.reset} ${logExtra(data)}`);
  }
  recordBenchmark({
    name,
    passed: ok,
    duration,
    expected: "status 200",
    actual: `status ${response.status}`,
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
  const retOk = retRes.ok;
  console.log(
    `${retOk ? `${colors.green}✓` : `${colors.red}✗`}${colors.reset} POST /api/users/?returning=id,name,email → ${formatDuration(retDuration, 500)} ${retOk ? "✓" : "✗"}`
  );
  if (retOk) {
    const data = (await retRes.json()) as Record<string, unknown>;
    const fields = Object.keys(data);
    console.log(
      `  ${colors.blue}→${colors.reset} Returned fields: ${fields.join(", ")}`
    );
  }
  recordBenchmark({
    name: "POST: Selective RETURNING",
    passed: retOk,
    duration: retDuration,
    expected: "status 201",
    actual: `status ${retRes.status}`,
    error: retOk ? undefined : await retRes.clone().text(),
  });

  // POST with on_conflict DO NOTHING (upsert - skip duplicate)
  const testUser2 = {
    name: `Benchmark Upsert ${timestamp}`,
    email: `benchmark-upsert-${timestamp}@example.com`,
    is_active: true,
  };

  // First insert
  await timedRequest(`${API_BASE_URL}/api/users/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testUser2),
  });

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
  const nothingOk = nothingRes.status === 204;
  console.log(
    `${nothingOk ? `${colors.green}✓` : `${colors.red}✗`}${colors.reset} POST /api/users/?on_conflict=email&on_conflict_action=nothing → ${formatDuration(nothingDuration, 500)} ${nothingOk ? "✓" : "✗"}`
  );
  if (nothingOk) {
    console.log(
      `  ${colors.blue}→${colors.reset} Conflict handled: 204 No Content (no insert performed)`
    );
  }
  recordBenchmark({
    name: "POST: ON CONFLICT DO NOTHING",
    passed: nothingOk,
    duration: nothingDuration,
    expected: "status 204",
    actual: `status ${nothingRes.status}`,
    error: nothingOk ? undefined : await nothingRes.clone().text(),
  });

  // POST with on_conflict DO UPDATE (upsert - update on duplicate)
  const testUser3 = {
    name: `Benchmark Update ${timestamp}`,
    email: `benchmark-update-${timestamp}@example.com`,
    is_active: true,
  };

  // First insert
  await timedRequest(`${API_BASE_URL}/api/users/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testUser3),
  });

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
  const updateOk = updateRes.ok;
  console.log(
    `${updateOk ? `${colors.green}✓` : `${colors.red}✗`}${colors.reset} POST /api/users/?on_conflict=email&on_conflict_update=name → ${formatDuration(updateDuration, 500)} ${updateOk ? "✓" : "✗"}`
  );
  if (updateOk) {
    const data = (await updateRes.json()) as Record<string, unknown>;
    console.log(
      `  ${colors.blue}→${colors.reset} Upserted user: ${data.name ?? "(no name returned)"}`
    );
  }
  recordBenchmark({
    name: "POST: ON CONFLICT DO UPDATE",
    passed: updateOk,
    duration: updateDuration,
    expected: "status 201",
    actual: `status ${updateRes.status}`,
    error: updateOk ? undefined : await updateRes.clone().text(),
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

  console.log(
    `${allOk ? `${colors.green}✓` : `${colors.red}✗`}${colors.reset} 10 parallel requests`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} Total time: ${Math.round(totalDuration)}ms`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} Average per request: ${avgDuration}ms`
  );
  console.log(
    `  ${colors.blue}→${colors.reset} All succeeded: ${allOk ? `${colors.green}Yes ✓${colors.reset}` : `${colors.red}No ✗${colors.reset}`}`
  );

  recordBenchmark({
    name: "Concurrent: 10 parallel requests",
    passed: allOk,
    duration: totalDuration,
    expected: "all success",
    actual: allOk ? "all success" : "some failed",
  });

  recordBenchmark({
    name: "Concurrent: Average response time",
    passed: avgDuration < 600,
    duration: avgDuration,
    expected: "< 600ms",
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
    await benchmarkConcurrentLoad();
  } catch (error) {
    console.error(
      `\n${colors.red}Fatal error during benchmarks:${colors.reset}`,
      error
    );
    process.exit(1);
  }

  printSummary();
}

main();
