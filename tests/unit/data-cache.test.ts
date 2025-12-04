import { beforeEach, describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noEmptyBlockStatements: noop for mocking console.error
const noop = () => {};

import {
  bumpTableVersion,
  type CachedOpenApi,
  type CachedQueryResult,
  deleteCachedKey,
  getListCacheKey,
  getQueryCachePrefix,
  getTableVersion,
  readCachedOpenApi,
  readCachedQueryResult,
  setTableVersion,
  writeCachedOpenApi,
  writeCachedQueryResult,
} from "@/lib/data-cache";

describe("data-cache", () => {
  describe("Cache key generation", () => {
    it("should generate list cache key with table name", () => {
      const key = getListCacheKey("users");
      expect(key).toBe("data:users:list");
    });

    it("should generate query cache prefix with table name", () => {
      const prefix = getQueryCachePrefix("users");
      expect(prefix).toBe("data:users:query:");
    });

    it("should handle different table names", () => {
      expect(getListCacheKey("products")).toBe("data:products:list");
      expect(getQueryCachePrefix("orders")).toBe("data:orders:query:");
    });
  });

  describe("readCachedQueryResult", () => {
    it("should return null when kv is undefined", async () => {
      const result = await readCachedQueryResult(undefined, "test-key");
      expect(result).toBeNull();
    });

    it("should return null when key not found", async () => {
      const mockKv = {
        get: vi.fn().mockResolvedValue(null),
      } as unknown as KVNamespace;

      const result = await readCachedQueryResult(mockKv, "test-key");
      expect(result).toBeNull();
      expect(mockKv.get).toHaveBeenCalledWith("test-key");
    });

    it("should return parsed cached result", async () => {
      const cachedData: CachedQueryResult = {
        data: [{ id: 1, name: "Test" }],
        cachedAt: Date.now(),
        version: "123",
      };
      const mockKv = {
        get: vi.fn().mockResolvedValue(JSON.stringify(cachedData)),
      } as unknown as KVNamespace;

      const result = await readCachedQueryResult(mockKv, "test-key");
      expect(result).toEqual(cachedData);
    });

    it("should return null on invalid JSON", async () => {
      const mockKv = {
        get: vi.fn().mockResolvedValue("invalid json {"),
      } as unknown as KVNamespace;
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(noop);

      const result = await readCachedQueryResult(mockKv, "test-key");
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("writeCachedQueryResult", () => {
    it("should do nothing when kv is undefined", async () => {
      await writeCachedQueryResult(undefined, "test-key", {
        data: [],
        cachedAt: Date.now(),
        version: "1",
      });
      // Should not throw
    });

    it("should write JSON to kv", async () => {
      const mockKv = {
        put: vi.fn().mockResolvedValue(undefined),
      } as unknown as KVNamespace;

      const payload: CachedQueryResult = {
        data: [{ id: 1 }],
        cachedAt: Date.now(),
        version: "123",
      };

      await writeCachedQueryResult(mockKv, "test-key", payload);
      expect(mockKv.put).toHaveBeenCalledWith(
        "test-key",
        JSON.stringify(payload)
      );
    });

    it("should handle write errors gracefully", async () => {
      const mockKv = {
        put: vi.fn().mockRejectedValue(new Error("Write failed")),
      } as unknown as KVNamespace;
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(noop);

      await writeCachedQueryResult(mockKv, "test-key", {
        data: [],
        cachedAt: Date.now(),
        version: "1",
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("deleteCachedKey", () => {
    it("should do nothing when kv is undefined", async () => {
      await deleteCachedKey(undefined, "test-key");
      // Should not throw
    });

    it("should delete key from kv", async () => {
      const mockKv = {
        delete: vi.fn().mockResolvedValue(undefined),
      } as unknown as KVNamespace;

      await deleteCachedKey(mockKv, "test-key");
      expect(mockKv.delete).toHaveBeenCalledWith("test-key");
    });

    it("should handle delete errors gracefully", async () => {
      const mockKv = {
        delete: vi.fn().mockRejectedValue(new Error("Delete failed")),
      } as unknown as KVNamespace;
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(noop);

      await deleteCachedKey(mockKv, "test-key");

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("readCachedOpenApi", () => {
    it("should return null when kv is undefined", async () => {
      const result = await readCachedOpenApi(undefined);
      expect(result).toBeNull();
    });

    it("should return null when not found", async () => {
      const mockKv = {
        get: vi.fn().mockResolvedValue(null),
      } as unknown as KVNamespace;

      const result = await readCachedOpenApi(mockKv);
      expect(result).toBeNull();
      expect(mockKv.get).toHaveBeenCalledWith("data:openapi");
    });

    it("should return parsed OpenAPI spec", async () => {
      const cachedSpec: CachedOpenApi = {
        spec: { openapi: "3.0.0", info: { title: "Test", version: "1.0" } },
        version: "123",
        cachedAt: Date.now(),
      };
      const mockKv = {
        get: vi.fn().mockResolvedValue(JSON.stringify(cachedSpec)),
      } as unknown as KVNamespace;

      const result = await readCachedOpenApi(mockKv);
      expect(result).toEqual(cachedSpec);
    });
  });

  describe("writeCachedOpenApi", () => {
    it("should do nothing when kv is undefined", async () => {
      await writeCachedOpenApi(undefined, {
        spec: {},
        version: "1",
        cachedAt: Date.now(),
      });
      // Should not throw
    });

    it("should write OpenAPI spec to kv", async () => {
      const mockKv = {
        put: vi.fn().mockResolvedValue(undefined),
      } as unknown as KVNamespace;

      const payload: CachedOpenApi = {
        spec: { openapi: "3.0.0" },
        version: "123",
        cachedAt: Date.now(),
      };

      await writeCachedOpenApi(mockKv, payload);
      expect(mockKv.put).toHaveBeenCalledWith(
        "data:openapi",
        JSON.stringify(payload)
      );
    });

    it("should handle write errors gracefully", async () => {
      const mockKv = {
        put: vi.fn().mockRejectedValue(new Error("Write failed")),
      } as unknown as KVNamespace;
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(noop);

      await writeCachedOpenApi(mockKv, {
        spec: {},
        version: "1",
        cachedAt: Date.now(),
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("Table version management", () => {
    let mockKv: KVNamespace;

    beforeEach(() => {
      mockKv = {
        get: vi.fn(),
        put: vi.fn().mockResolvedValue(undefined),
      } as unknown as KVNamespace;
    });

    describe("getTableVersion", () => {
      it("should return null when kv is undefined", async () => {
        const result = await getTableVersion(undefined, "users");
        expect(result).toBeNull();
      });

      it("should return version from kv", async () => {
        vi.mocked(mockKv.get).mockResolvedValue("12345");

        const result = await getTableVersion(mockKv, "users");
        expect(result).toBe("12345");
        expect(mockKv.get).toHaveBeenCalledWith("version:users");
      });

      it("should return null when version not set", async () => {
        vi.mocked(mockKv.get).mockResolvedValue(null);

        const result = await getTableVersion(mockKv, "users");
        expect(result).toBeNull();
      });
    });

    describe("setTableVersion", () => {
      it("should do nothing when kv is undefined", async () => {
        await setTableVersion(undefined, "users", "123");
        // Should not throw
      });

      it("should set version in kv", async () => {
        await setTableVersion(mockKv, "users", "12345");
        expect(mockKv.put).toHaveBeenCalledWith("version:users", "12345");
      });
    });

    describe("bumpTableVersion", () => {
      it("should set new timestamp-based version", async () => {
        const beforeTime = Date.now();
        const newVersion = await bumpTableVersion(mockKv, "users");
        const afterTime = Date.now();

        expect(Number(newVersion)).toBeGreaterThanOrEqual(beforeTime);
        expect(Number(newVersion)).toBeLessThanOrEqual(afterTime);
        expect(mockKv.put).toHaveBeenCalledWith("version:users", newVersion);
      });

      it("should return the new version string", async () => {
        const version = await bumpTableVersion(mockKv, "products");
        expect(typeof version).toBe("string");
        expect(version.length).toBeGreaterThan(0);
      });
    });
  });
});
