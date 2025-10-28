export interface DeviceRecord {
  retail_branding: string;
  marketing_name: string;
  device: string;
  model: string;
}

export interface DeviceLookupResponse {
  total_matches: number;
  limit: number;
  page: number;
  total_pages: number;
  results: DeviceRecord[];
}

export const DEFAULT_LIMIT = 25;

const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "") as string;
const apiBaseUrl = rawBaseUrl ? rawBaseUrl.replace(/\/$/, "") : "/api";

const DEVICE_CACHE_PREFIX = "device_cache_v1_";
const DEVICE_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const SERVICE_WARMUP_TIMEOUT_MS = 15_000; // Give the backend a generous head start before surfacing warmup UI

export class ServiceWarmingError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "ServiceWarmingError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface LookupParams {
  brand?: string;
  marketing_name?: string;
  device?: string;
  model?: string;
  limit?: number;
  page?: number;
}

interface NormalizedLookupParams {
  brand: string;
  marketing_name: string;
  device: string;
  model: string;
  limit: number;
  page: number;
}

interface DeviceCacheEntry {
  data: DeviceLookupResponse;
  timestamp: number;
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeLookupParams(params: LookupParams): NormalizedLookupParams {
  const normalizeText = (value?: string) => (value ?? "").trim();
  const normalizeNumber = (value: number | undefined, fallback: number) => {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.max(1, Math.floor(value as number));
  };

  return {
    brand: normalizeText(params.brand),
    marketing_name: normalizeText(params.marketing_name),
    device: normalizeText(params.device),
    model: normalizeText(params.model),
    limit: normalizeNumber(params.limit, DEFAULT_LIMIT),
    page: normalizeNumber(params.page, 1),
  };
}

function buildCacheKey(params: NormalizedLookupParams): string {
  const keyPayload = {
    brand: params.brand,
    marketing_name: params.marketing_name,
    device: params.device,
    model: params.model,
    limit: params.limit,
    page: params.page,
  };
  return `${DEVICE_CACHE_PREFIX}${JSON.stringify(keyPayload)}`;
}

export function getCachedLookupResult(params: LookupParams): DeviceLookupResponse | null {
  if (!isBrowser()) {
    return null;
  }

  const normalized = normalizeLookupParams(params);
  const cacheKey = buildCacheKey(normalized);
  const raw = window.localStorage.getItem(cacheKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed: DeviceCacheEntry = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.timestamp !== "number" || parsed.timestamp <= 0) {
      return null;
    }
    if (Date.now() - parsed.timestamp > DEVICE_CACHE_TTL_MS) {
      window.localStorage.removeItem(cacheKey);
      return null;
    }
    return parsed.data ?? null;
  } catch (error) {
    window.localStorage.removeItem(cacheKey);
    return null;
  }
}

function setCachedLookupResult(
  params: LookupParams,
  data: DeviceLookupResponse
): void {
  if (!isBrowser()) {
    return;
  }
  try {
    const normalized = normalizeLookupParams(params);
    const cacheKey = buildCacheKey(normalized);
    const entry: DeviceCacheEntry = {
      data,
      timestamp: Date.now(),
    };
    window.localStorage.setItem(cacheKey, JSON.stringify(entry));
  } catch (error) {
    // Ignore quota or serialization errors silently.
  }
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === "") {
      return;
    }
    search.set(key, String(value));
  });
  return search.toString();
}

export async function lookupDevices(params: LookupParams) {
  const normalized = normalizeLookupParams(params);
  const query = buildQuery({
    brand: normalized.brand || undefined,
    marketing_name: normalized.marketing_name || undefined,
    device: normalized.device || undefined,
    model: normalized.model || undefined,
    limit: normalized.limit,
    page: normalized.page,
  });
  const url = `${apiBaseUrl}/check?${query}`;
  const response = await (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, SERVICE_WARMUP_TIMEOUT_MS);

    try {
      return await fetch(url, {
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        // Surface the warmup UI when the backend is still cold and does not answer quickly.
        throw new ServiceWarmingError(
          "Service is taking longer than expected to respond. Trying again shortly.",
          Math.ceil(SERVICE_WARMUP_TIMEOUT_MS / 1000)
        );
      }

      throw error instanceof Error ? error : new Error("Request failed");
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    let parsed: unknown;

    try {
      parsed = isJson ? await response.json() : await response.text();
    } catch (error) {
      parsed = null;
    }

    if (response.status === 503) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterSeconds = Math.max(
        1,
        Number.isInteger(Number(retryAfterHeader))
          ? Number(retryAfterHeader)
          : Number.parseInt(retryAfterHeader ?? "", 10) || 3
      );
      const message =
        typeof parsed === "string"
          ? parsed || "Service is warming up."
          : typeof parsed === "object" && parsed !== null && "detail" in parsed
          ? String((parsed as { detail?: unknown }).detail) || "Service is warming up."
          : "Service is warming up.";
      throw new ServiceWarmingError(message, retryAfterSeconds);
    }

    const message =
      typeof parsed === "string"
        ? parsed
        : typeof parsed === "object" && parsed !== null && "detail" in parsed
        ? String((parsed as { detail?: unknown }).detail)
        : null;

    throw new Error(message || `Request failed with status ${response.status}`);
  }

  const data: DeviceLookupResponse = await response.json();
  setCachedLookupResult(params, data);
  return data;
}
