/**
 * Unit tests for cache utility
 * Tests localStorage-based caching behavior
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  generateCacheKey,
  getCachedData,
  setCachedData,
  clearOldCache,
  clearAllCache,
  getCacheStats,
} from "./cache";
import type { DeviceLookupResponse } from "./api";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => {
      const keys = Object.keys(store);
      return keys[index] || null;
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

describe("Cache Utility", () => {
  const mockResponse: DeviceLookupResponse = {
    total_matches: 1,
    limit: 50,
    page: 1,
    total_pages: 1,
    results: [
      {
        retail_branding: "Google",
        marketing_name: "Pixel 9",
        device: "akita",
        model: "GR1YH",
      },
    ],
  };

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe("generateCacheKey", () => {
    it("should generate consistent keys for same parameters", () => {
      const params = {
        brand: "Google",
        model: "Pixel",
        limit: 50,
        page: 1,
      };

      const key1 = generateCacheKey(params);
      const key2 = generateCacheKey(params);

      expect(key1).toBe(key2);
    });

    it("should generate different keys for different parameters", () => {
      const params1 = { brand: "Google", limit: 50, page: 1 };
      const params2 = { brand: "Samsung", limit: 50, page: 1 };

      const key1 = generateCacheKey(params1);
      const key2 = generateCacheKey(params2);

      expect(key1).not.toBe(key2);
    });

    it("should normalize parameter values (case and whitespace)", () => {
      const params1 = { brand: "  Google  ", limit: 50, page: 1 };
      const params2 = { brand: "google", limit: 50, page: 1 };

      const key1 = generateCacheKey(params1);
      const key2 = generateCacheKey(params2);

      expect(key1).toBe(key2);
    });

    it("should treat undefined and empty string as same", () => {
      const params1 = { brand: undefined, limit: 50, page: 1 };
      const params2 = { brand: "", limit: 50, page: 1 };

      const key1 = generateCacheKey(params1);
      const key2 = generateCacheKey(params2);

      expect(key1).toBe(key2);
    });

    it("should include pagination in cache key", () => {
      const params1 = { brand: "Google", limit: 50, page: 1 };
      const params2 = { brand: "Google", limit: 50, page: 2 };

      const key1 = generateCacheKey(params1);
      const key2 = generateCacheKey(params2);

      expect(key1).not.toBe(key2);
    });
  });

  describe("setCachedData and getCachedData", () => {
    it("should store and retrieve data successfully", () => {
      const cacheKey = generateCacheKey({ brand: "Google", limit: 50, page: 1 });

      setCachedData(cacheKey, mockResponse);
      const retrieved = getCachedData(cacheKey);

      expect(retrieved).toEqual(mockResponse);
    });

    it("should return null for non-existent cache key", () => {
      const cacheKey = "non_existent_key";
      const retrieved = getCachedData(cacheKey);

      expect(retrieved).toBeNull();
    });

    it("should return null for expired cache entries", () => {
      const cacheKey = generateCacheKey({ brand: "Google", limit: 50, page: 1 });

      // Store data with old timestamp
      const expiredEntry = {
        data: mockResponse,
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        cacheKey,
      };
      localStorage.setItem(cacheKey, JSON.stringify(expiredEntry));

      const retrieved = getCachedData(cacheKey);

      expect(retrieved).toBeNull();
      // Should also remove expired entry
      expect(localStorage.getItem(cacheKey)).toBeNull();
    });

    it("should store timestamp with cached data", () => {
      const cacheKey = generateCacheKey({ brand: "Google", limit: 50, page: 1 });
      const beforeTime = Date.now();

      setCachedData(cacheKey, mockResponse);

      const afterTime = Date.now();
      const stored = localStorage.getItem(cacheKey);
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(parsed.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it("should handle malformed cache entries gracefully", () => {
      const cacheKey = "malformed_entry";
      localStorage.setItem(cacheKey, "invalid json");

      const retrieved = getCachedData(cacheKey);

      expect(retrieved).toBeNull();
    });
  });

  describe("clearOldCache", () => {
    it("should remove expired entries", () => {
      const key1 = generateCacheKey({ brand: "Google", limit: 50, page: 1 });
      const key2 = generateCacheKey({ brand: "Samsung", limit: 50, page: 1 });

      // Fresh entry
      setCachedData(key1, mockResponse);

      // Expired entry
      const expiredEntry = {
        data: mockResponse,
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        cacheKey: key2,
      };
      localStorage.setItem(key2, JSON.stringify(expiredEntry));

      clearOldCache();

      expect(getCachedData(key1)).not.toBeNull(); // Fresh should remain
      expect(getCachedData(key2)).toBeNull(); // Expired should be gone
    });

    it("should not remove fresh entries", () => {
      const cacheKey = generateCacheKey({ brand: "Google", limit: 50, page: 1 });

      setCachedData(cacheKey, mockResponse);
      clearOldCache();

      const retrieved = getCachedData(cacheKey);
      expect(retrieved).not.toBeNull();
    });

    it("should remove malformed entries during cleanup", () => {
      const validKey = generateCacheKey({ brand: "Google", limit: 50, page: 1 });
      const malformedKey = "device_cache_v1_malformed";

      setCachedData(validKey, mockResponse);
      localStorage.setItem(malformedKey, "invalid json");

      clearOldCache();

      expect(getCachedData(validKey)).not.toBeNull();
      expect(localStorage.getItem(malformedKey)).toBeNull();
    });
  });

  describe("clearAllCache", () => {
    it("should remove all cache entries", () => {
      const key1 = generateCacheKey({ brand: "Google", limit: 50, page: 1 });
      const key2 = generateCacheKey({ brand: "Samsung", limit: 50, page: 1 });

      setCachedData(key1, mockResponse);
      setCachedData(key2, mockResponse);

      expect(localStorage.length).toBeGreaterThan(0);

      clearAllCache();

      expect(localStorage.length).toBe(0);
      expect(getCachedData(key1)).toBeNull();
      expect(getCachedData(key2)).toBeNull();
    });

    it("should not affect non-cache localStorage items", () => {
      const cacheKey = generateCacheKey({ brand: "Google", limit: 50, page: 1 });
      const otherKey = "some_other_app_data";

      setCachedData(cacheKey, mockResponse);
      localStorage.setItem(otherKey, "important data");

      clearAllCache();

      expect(getCachedData(cacheKey)).toBeNull();
      expect(localStorage.getItem(otherKey)).toBe("important data");
    });
  });

  describe("getCacheStats", () => {
    it("should return correct statistics", () => {
      const key1 = generateCacheKey({ brand: "Google", limit: 50, page: 1 });
      const key2 = generateCacheKey({ brand: "Samsung", limit: 50, page: 1 });

      setCachedData(key1, mockResponse);
      setCachedData(key2, mockResponse);

      const stats = getCacheStats();

      expect(stats.totalEntries).toBe(2);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.oldestEntry).not.toBeNull();
    });

    it("should return zero stats for empty cache", () => {
      const stats = getCacheStats();

      expect(stats.totalEntries).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.oldestEntry).toBeNull();
    });

    it("should track oldest entry correctly", () => {
      const key1 = generateCacheKey({ brand: "Google", limit: 50, page: 1 });

      const oldTimestamp = Date.now() - 1000;
      const oldEntry = {
        data: mockResponse,
        timestamp: oldTimestamp,
        cacheKey: key1,
      };
      localStorage.setItem(key1, JSON.stringify(oldEntry));

      // Add newer entry
      const key2 = generateCacheKey({ brand: "Samsung", limit: 50, page: 1 });
      setCachedData(key2, mockResponse);

      const stats = getCacheStats();

      expect(stats.oldestEntry).toBe(oldTimestamp);
    });
  });

  describe("Cache expiration edge cases", () => {
    it("should accept cache entries at exactly 24 hours old", () => {
      const cacheKey = generateCacheKey({ brand: "Google", limit: 50, page: 1 });

      const exactlyOneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const entry = {
        data: mockResponse,
        timestamp: exactlyOneDayAgo,
        cacheKey,
      };
      localStorage.setItem(cacheKey, JSON.stringify(entry));

      const retrieved = getCachedData(cacheKey);

      expect(retrieved).toEqual(mockResponse);
    });

    it("should reject cache entries just over 24 hours old", () => {
      const cacheKey = generateCacheKey({ brand: "Google", limit: 50, page: 1 });

      const justOver24Hours = Date.now() - (24 * 60 * 60 * 1000 + 1);
      const entry = {
        data: mockResponse,
        timestamp: justOver24Hours,
        cacheKey,
      };
      localStorage.setItem(cacheKey, JSON.stringify(entry));

      const retrieved = getCachedData(cacheKey);

      expect(retrieved).toBeNull();
    });
  });
});
