/**
 * Browser cache utility for API responses using localStorage
 * Reduces API calls by caching search results locally
 */

import type { DeviceLookupResponse } from "./api";

interface CacheEntry {
  data: DeviceLookupResponse;
  timestamp: number;
  cacheKey: string;
}

const CACHE_PREFIX = "device_cache_";
const CACHE_VERSION = "v1_";
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours (matches backend cache)

/**
 * Generate a unique cache key from search parameters
 */
export function generateCacheKey(params: {
  brand?: string;
  marketingName?: string;
  device?: string;
  model?: string;
  limit: number;
  page: number;
}): string {
  const normalized = {
    brand: params.brand?.toLowerCase().trim() || "",
    marketingName: params.marketingName?.toLowerCase().trim() || "",
    device: params.device?.toLowerCase().trim() || "",
    model: params.model?.toLowerCase().trim() || "",
    limit: params.limit,
    page: params.page,
  };
  return `${CACHE_PREFIX}${CACHE_VERSION}${JSON.stringify(normalized)}`;
}

/**
 * Get cached data if it exists and is not expired
 */
export function getCachedData(cacheKey: string): DeviceLookupResponse | null {
  try {
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;

    const entry: CacheEntry = JSON.parse(cached);
    const age = Date.now() - entry.timestamp;

    // Check if cache is expired
    if (age > CACHE_DURATION_MS) {
      localStorage.removeItem(cacheKey);
      return null;
    }

    console.log(`[Cache HIT] Retrieved from cache (age: ${Math.round(age / 1000 / 60)} minutes)`);
    return entry.data;
  } catch (error) {
    console.error("[Cache] Error reading cache:", error);
    return null;
  }
}

/**
 * Store data in cache
 */
export function setCachedData(
  cacheKey: string,
  data: DeviceLookupResponse
): void {
  try {
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      cacheKey,
    };
    localStorage.setItem(cacheKey, JSON.stringify(entry));
    console.log(`[Cache WRITE] Stored in cache: ${cacheKey.substring(0, 50)}...`);
  } catch (error) {
    console.error("[Cache] Error writing cache:", error);
    // If localStorage is full, try clearing old entries
    if (error instanceof Error && error.name === "QuotaExceededError") {
      clearOldCache();
      try {
        const entry: CacheEntry = { data, timestamp: Date.now(), cacheKey };
        localStorage.setItem(cacheKey, JSON.stringify(entry));
      } catch {
        console.warn("[Cache] Unable to cache even after cleanup");
      }
    }
  }
}

/**
 * Clear all cache entries older than the cache duration
 */
export function clearOldCache(): void {
  try {
    const now = Date.now();
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX + CACHE_VERSION)) {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry: CacheEntry = JSON.parse(cached);
            if (now - entry.timestamp > CACHE_DURATION_MS) {
              keysToRemove.push(key);
            }
          }
        } catch {
          // Invalid entry, mark for removal
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));
    if (keysToRemove.length > 0) {
      console.log(`[Cache] Cleared ${keysToRemove.length} expired entries`);
    }
  } catch (error) {
    console.error("[Cache] Error clearing old cache:", error);
  }
}

/**
 * Clear all cache entries (useful for testing or manual refresh)
 */
export function clearAllCache(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    console.log(`[Cache] Cleared all cache entries (${keysToRemove.length})`);
  } catch (error) {
    console.error("[Cache] Error clearing cache:", error);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  totalEntries: number;
  totalSize: number;
  oldestEntry: number | null;
} {
  let totalEntries = 0;
  let totalSize = 0;
  let oldestTimestamp: number | null = null;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX + CACHE_VERSION)) {
        totalEntries++;
        const cached = localStorage.getItem(key);
        if (cached) {
          totalSize += cached.length;
          try {
            const entry: CacheEntry = JSON.parse(cached);
            if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
              oldestTimestamp = entry.timestamp;
            }
          } catch {
            // Skip invalid entries
          }
        }
      }
    }
  } catch (error) {
    console.error("[Cache] Error getting stats:", error);
  }

  return { totalEntries, totalSize, oldestEntry: oldestTimestamp };
}
