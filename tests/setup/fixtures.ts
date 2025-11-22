import type { ColumnConfig } from "@/types";

/**
 * Sample column configurations for testing
 */

export const USERS_TABLE_COLUMNS: ColumnConfig[] = [
  { name: "id", type: "integer", nullable: false },
  { name: "name", type: "text", nullable: false },
  { name: "email", type: "character varying", nullable: false },
  { name: "age", type: "integer", nullable: true },
  { name: "is_active", type: "boolean", nullable: false },
  { name: "created_at", type: "timestamp without time zone", nullable: false },
];

export const PRODUCTS_TABLE_COLUMNS: ColumnConfig[] = [
  { name: "id", type: "integer", nullable: false },
  { name: "title", type: "text", nullable: false },
  { name: "description", type: "text", nullable: true },
  { name: "price", type: "integer", nullable: false },
  { name: "in_stock", type: "boolean", nullable: false },
];

export const POSTS_TABLE_COLUMNS: ColumnConfig[] = [
  { name: "id", type: "integer", nullable: false },
  { name: "title", type: "character varying", nullable: false },
  { name: "content", type: "text", nullable: true },
  { name: "published", type: "boolean", nullable: false },
];

/**
 * Column config with unknown PostgreSQL type (for fallback testing)
 */
export const TABLE_WITH_UNKNOWN_TYPE: ColumnConfig[] = [
  { name: "id", type: "integer", nullable: false },
  { name: "data", type: "jsonb", nullable: true },
  { name: "location", type: "geography", nullable: true },
];

/**
 * Table without an 'id' column (edge case)
 */
export const TABLE_WITHOUT_ID: ColumnConfig[] = [
  { name: "user_id", type: "integer", nullable: false },
  { name: "name", type: "text", nullable: false },
];

/**
 * Empty column configuration (for error testing)
 */
export const EMPTY_TABLE_COLUMNS: ColumnConfig[] = [];

/**
 * Mock database query results
 */

export const MOCK_TABLE_VERSION_RESULT = [{ version_id: "12345" }];

export const MOCK_TABLE_CONFIG_QUERY_RESULT = [
  { column_name: "id", data_type: "integer", is_nullable: "NO" },
  { column_name: "name", data_type: "text", is_nullable: "NO" },
  { column_name: "email", data_type: "character varying", is_nullable: "NO" },
  { column_name: "age", data_type: "integer", is_nullable: "YES" },
];

export const MOCK_ENTIRE_SCHEMA_RESULT = [
  {
    table_name: "users",
    column_name: "id",
    data_type: "integer",
    is_nullable: "NO",
  },
  {
    table_name: "users",
    column_name: "name",
    data_type: "text",
    is_nullable: "NO",
  },
  {
    table_name: "posts",
    column_name: "id",
    data_type: "integer",
    is_nullable: "NO",
  },
  {
    table_name: "posts",
    column_name: "title",
    data_type: "text",
    is_nullable: "NO",
  },
];

/**
 * Sample data for CRUD operations
 */

export const SAMPLE_USER = {
  id: 1,
  name: "John Doe",
  email: "john@example.com",
  age: 30,
  is_active: true,
  created_at: "2024-01-01T00:00:00.000Z",
};

export const SAMPLE_USERS = [
  SAMPLE_USER,
  {
    id: 2,
    name: "Jane Smith",
    email: "jane@example.com",
    age: 25,
    is_active: true,
    created_at: "2024-01-02T00:00:00.000Z",
  },
  {
    id: 3,
    name: "Bob Johnson",
    email: "bob@example.com",
    age: null,
    is_active: false,
    created_at: "2024-01-03T00:00:00.000Z",
  },
];

// Input for POST tests - matches what insert schema expects (all fields except id)
export const NEW_USER_INPUT = {
  name: "Alice Williams",
  email: "alice@example.com",
  age: 28,
  is_active: true,
  created_at: "2024-01-04T00:00:00.000Z",
};

export const NEW_USER_INPUT_WITH_NULL_AGE = {
  name: "Alice Williams",
  email: "alice@example.com",
  age: null,
  is_active: true,
  created_at: "2024-01-04T00:00:00.000Z",
};

// Minimal input for testing (only required non-auto fields)
export const MINIMAL_USER_INPUT = {
  name: "Alice Williams",
  email: "alice@example.com",
  is_active: true,
  created_at: "2024-01-04",
};

export const SAMPLE_PRODUCT = {
  id: 1,
  title: "Test Product",
  description: "A test product",
  price: 9999,
  in_stock: true,
};

export const SAMPLE_PRODUCTS = [
  SAMPLE_PRODUCT,
  {
    id: 2,
    title: "Another Product",
    description: null,
    price: 4999,
    in_stock: false,
  },
];

/**
 * Test connection strings
 */
export const TEST_CONNECTION_STRING =
  "postgresql://test:test@localhost:5432/testdb";
export const TEST_CONNECTION_STRING_ALT =
  "postgresql://user:pass@localhost:5432/altdb";

/**
 * Common test table names
 */
export const TEST_TABLE_NAMES = {
  USERS: "users",
  PRODUCTS: "products",
  POSTS: "posts",
  NONEXISTENT: "nonexistent_table",
} as const;
