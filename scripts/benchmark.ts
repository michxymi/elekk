#!/usr/bin/env tsx

/**
 * Elekk Performance Benchmark Suite
 *
 * Comprehensive performance benchmarks for the deployed Elekk API.
 * Benchmarks cache behavior, introspection overhead, and CRUD operations.
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
 * Benchmark: Cache hit performance
 */
async function benchmarkCacheHits(): Promise<void> {
  printSection("CACHE HIT PERFORMANCE");

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
  const usersOk = avgUsersDuration < 150;

  console.log(
    `${usersOk ? `${colors.green}✓` : `${colors.yellow}⚠`}${colors.reset} GET /api/users/ (avg of 3) → ${formatDuration(avgUsersDuration, 150)} ${usersOk ? "✓" : "(slower than target)"}`
  );

  recordBenchmark({
    name: "Cache hit: GET /api/users/ average",
    passed: usersOk,
    duration: avgUsersDuration,
    expected: "< 150ms",
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
  const productsOk = avgProductsDuration < 150;

  console.log(
    `${productsOk ? `${colors.green}✓` : `${colors.yellow}⚠`}${colors.reset} GET /api/products/ (avg of 3) → ${formatDuration(avgProductsDuration, 150)} ${productsOk ? "✓" : "(slower than target)"}`
  );

  recordBenchmark({
    name: "Cache hit: GET /api/products/ average",
    passed: productsOk,
    duration: avgProductsDuration,
    expected: "< 150ms",
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
 * Benchmark: Cache speedup analysis
 */
async function benchmarkCacheSpeedup(): Promise<void> {
  printSection("CACHE SPEEDUP ANALYSIS");

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
  const speedupOk = speedup >= 1.2;

  console.log(`Cold start: ${Math.round(coldDuration)}ms`);
  console.log(`Cache hit: ${Math.round(warmDuration)}ms`);
  console.log(
    `${speedupOk ? `${colors.green}✓` : `${colors.yellow}⚠`}${colors.reset} Speedup: ${colors.bright}${speedup.toFixed(1)}x${colors.reset} ${speedupOk ? "✓" : "(below 1.2x target)"}`
  );

  recordBenchmark({
    name: "Cache speedup ratio",
    passed: speedupOk,
    duration: warmDuration,
    expected: ">= 1.2x",
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
    passed: avgDuration < 250,
    duration: avgDuration,
    expected: "< 250ms",
    actual: `${avgDuration}ms`,
  });
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
    await benchmarkColdStart();
    await benchmarkCacheHits();
    await benchmarkCacheSpeedup();
    await benchmarkCrudOperations();
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
