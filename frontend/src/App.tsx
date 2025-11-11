import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_LIMIT,
  lookupDevices,
  type DeviceLookupResponse,
  ServiceWarmingError,
  getCachedLookupResult,
  fetchApiHealth,
} from "./api";
import {
  generateCacheKey,
  getCachedData,
  setCachedData,
  clearOldCache,
} from "./cache";
import { APP_VERSION } from "./version";

interface FormState {
  brand: string;
  marketingName: string;
  device: string;
  model: string;
  limit: string;
}

const initialFormState: FormState = {
  brand: "",
  marketingName: "",
  device: "",
  model: "",
  limit: String(DEFAULT_LIMIT),
};

const WARMUP_MIN_DELAY_SECONDS = 20;

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "gcdc-theme-preference";

function readStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Ignore storage failures; theme preference persistence is optional.
  }

  return null;
}

function readSystemTheme(): ThemeMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function App() {
  const [themeState, setThemeState] = useState<{ theme: ThemeMode; isSystem: boolean }>(() => {
    const storedTheme = readStoredTheme();
    if (storedTheme) {
      return { theme: storedTheme, isSystem: false };
    }

    return { theme: readSystemTheme(), isSystem: true };
  });
  const { theme, isSystem } = themeState;
  const [form, setForm] = useState<FormState>(initialFormState);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isWaitingForWarmup, setIsWaitingForWarmup] = useState(false);
  const [results, setResults] = useState<DeviceLookupResponse | null>(null);
  const [page, setPage] = useState(1);
  const warmupRetryTimer = useRef<number | null>(null);
  const warmupCountdownTimer = useRef<number | null>(null);
  const [warmupRetryCount, setWarmupRetryCount] = useState(0);
  const [warmupRemainingSeconds, setWarmupRemainingSeconds] = useState<number | null>(null);
  const [warmupMessage, setWarmupMessage] = useState<string | null>(null);
  const [cacheStatusMessage, setCacheStatusMessage] = useState<string | null>(null);
  const [isUsingCachedResults, setIsUsingCachedResults] = useState(false);
  const [apiVersion, setApiVersion] = useState<string | null>(null);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.body.dataset.theme = theme;
    }

    if (typeof window === "undefined") {
      return;
    }

    try {
      if (isSystem) {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      }
    } catch {
      // Swallow storage errors so theme toggling still works.
    }
  }, [theme, isSystem]);

  useEffect(() => {
    if (!isSystem || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    setThemeState((prev) => {
      if (!prev.isSystem) {
        return prev;
      }

      const nextTheme = mediaQuery.matches ? "dark" : "light";
      if (prev.theme === nextTheme) {
        return prev;
      }

      return { theme: nextTheme, isSystem: true };
    });

    const listener = (event: MediaQueryListEvent) => {
      setThemeState((prev) => {
        if (!prev.isSystem) {
          return prev;
        }

        const nextTheme = event.matches ? "dark" : "light";
        if (prev.theme === nextTheme) {
          return prev;
        }

        return { theme: nextTheme, isSystem: true };
      });
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", listener);
      return () => {
        mediaQuery.removeEventListener("change", listener);
      };
    }

    mediaQuery.addListener(listener);
    return () => {
      mediaQuery.removeListener(listener);
    };
  }, [isSystem]);

  function stopWarmupTimers() {
    if (warmupRetryTimer.current !== null) {
      window.clearTimeout(warmupRetryTimer.current);
      warmupRetryTimer.current = null;
    }
    if (warmupCountdownTimer.current !== null) {
      window.clearInterval(warmupCountdownTimer.current);
      warmupCountdownTimer.current = null;
    }
  }

  function resetWarmupState() {
    stopWarmupTimers();
    setIsWaitingForWarmup(false);
    setWarmupMessage(null);
    setWarmupRemainingSeconds(null);
    setWarmupRetryCount(0);
  }

  useEffect(() => {
    return () => {
      stopWarmupTimers();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const health = await fetchApiHealth();
        const version = health.version?.trim();
        if (!cancelled && version) {
          setApiVersion(version);
        }
      } catch {
        // Ignore health fetch failures; UI can operate without API version info.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleToggleTheme() {
    setThemeState((prev) => ({
      theme: prev.theme === "dark" ? "light" : "dark",
      isSystem: false,
    }));
  }

  function handleUseSystemTheme() {
    setThemeState({ theme: readSystemTheme(), isSystem: true });
  }

  const canSubmit = useMemo(() => {
    return (
      form.brand.trim() !== "" ||
      form.marketingName.trim() !== "" ||
      form.device.trim() !== "" ||
      form.model.trim() !== ""
    );
  }, [form]);

  async function handleSearch(forceRemote = false) {
    await handleSearchForPage(1, { forceRemote });
  }

  async function handleSearchForPage(
    requestedPage: number,
    options: { forceRemote?: boolean; fromWarmupRetry?: boolean } = {}
  ) {
    const { forceRemote = false, fromWarmupRetry = false } = options;

    if (!canSubmit) {
      setError("Enter at least one filter to run a search.");
      setResults(null);
      setCacheStatusMessage(null);
      setIsUsingCachedResults(false);
      setIsLoading(false);
      return;
    }

    if (fromWarmupRetry) {
      stopWarmupTimers();
    } else {
      resetWarmupState();
      setCacheStatusMessage(null);
    }

    const normalizedLimit = normalizeLimit(form.limit);

    // Generate cache key for this search
    const cacheKey = generateCacheKey({
      brand: form.brand || undefined,
      marketingName: form.marketingName || undefined,
      device: form.device || undefined,
      model: form.model || undefined,
      limit: normalizedLimit,
      page: requestedPage,
    });

    // Check cache first
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
      setResults(cachedData);
      setPage(cachedData.page);
      setForm((prev) => ({ ...prev, limit: String(normalizedLimit) }));
      setError(null);
      return;
    }

    const lookupParams = {
      brand: form.brand || undefined,
      marketing_name: form.marketingName || undefined,
      device: form.device || undefined,
      model: form.model || undefined,
      limit: normalizedLimit,
      page: requestedPage,
    };

    const cachedResult = getCachedLookupResult(lookupParams);

    if (cachedResult) {
      setResults(cachedResult);
      setPage(cachedResult.page);
    }

    if (cachedResult && !forceRemote && !fromWarmupRetry) {
      setError(null);
      setIsLoading(false);
      setIsUsingCachedResults(true);
      setCacheStatusMessage(
        "Showing cached results. Use Refresh from Service to fetch the latest data."
      );
      return;
    }

    if (cachedResult && !fromWarmupRetry) {
      setCacheStatusMessage("Refreshing results from the service…");
      setIsUsingCachedResults(true);
    } else if (!fromWarmupRetry) {
      setIsUsingCachedResults(false);
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await lookupDevices(lookupParams);
      resetWarmupState();
      setResults(data);
      setPage(data.page);
      setForm((prev) => ({ ...prev, limit: String(normalizedLimit) }));
      setCacheStatusMessage(null);
      setIsUsingCachedResults(false);
      setIsLoading(false);
    } catch (err) {
      if (err instanceof ServiceWarmingError) {
        const retrySeconds = Math.max(
          WARMUP_MIN_DELAY_SECONDS,
          Math.ceil(err.retryAfterSeconds)
        );
        stopWarmupTimers();
        setIsWaitingForWarmup(true);
        const warmupText = err.message || "Service is warming up.";
        setWarmupMessage(
          cachedResult
            ? `${warmupText} Showing cached results while we retry.`
            : warmupText
        );
        setWarmupRetryCount((prev) => prev + 1);
        setWarmupRemainingSeconds(retrySeconds);
        warmupCountdownTimer.current = window.setInterval(() => {
          setWarmupRemainingSeconds((prevSeconds) => {
            if (prevSeconds === null) {
              return prevSeconds;
            }
            if (prevSeconds <= 1) {
              if (warmupCountdownTimer.current !== null) {
                window.clearInterval(warmupCountdownTimer.current);
                warmupCountdownTimer.current = null;
              }
              return 0;
            }
            return prevSeconds - 1;
          });
        }, 1000);
        warmupRetryTimer.current = window.setTimeout(() => {
          warmupRetryTimer.current = null;
          void handleSearchForPage(requestedPage, {
            fromWarmupRetry: true,
            forceRemote,
          });
        }, retrySeconds * 1000);
        if (cachedResult) {
          setIsUsingCachedResults(true);
          setCacheStatusMessage(
            "Showing cached results while the service wakes up."
          );
        } else {
          setIsUsingCachedResults(false);
          setCacheStatusMessage(null);
        }
        setIsLoading(false);
        return;
      }

      resetWarmupState();
      const message = err instanceof Error ? err.message : "Unexpected error";
      if (cachedResult) {
        setError(`${message}. Showing cached results from a previous search.`);
        setIsUsingCachedResults(true);
        setCacheStatusMessage(
          "Showing cached results. Use Refresh from Service to fetch the latest data."
        );
      } else {
        setError(message);
        setResults(null);
        setIsUsingCachedResults(false);
        setCacheStatusMessage(null);
      }
      setIsLoading(false);
    }
  }

  function updateField<T extends keyof FormState>(key: T, value: FormState[T]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setPage(1);
    setCacheStatusMessage(null);
    setIsUsingCachedResults(false);
  }

  function clearForm() {
    resetWarmupState();
    setForm(initialFormState);
    setResults(null);
    setError(null);
    setCacheStatusMessage(null);
    setIsUsingCachedResults(false);
    setIsLoading(false);
    setPage(1);
  }

  function normalizeLimit(raw: string): number {
    const trimmed = raw.trim();
    if (trimmed === "") {
      return DEFAULT_LIMIT;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_LIMIT;
    }

    const bounded = Math.min(500, Math.max(1, Math.floor(parsed)));
    return bounded;
  }

  const totalPages = results?.total_pages ?? 0;
  const totalMatches = results?.total_matches ?? 0;
  const currentPage = results?.page ?? 1;
  const hasRows = !!results && results.results.length > 0;
  const canGoPrev = totalMatches > 0 && currentPage > 1;
  const canGoNext = totalMatches > 0 && totalPages > 0 && currentPage < totalPages;
  const startIndex = hasRows ? (currentPage - 1) * results.limit + 1 : 0;
  const endIndex = hasRows ? startIndex + results.results.length - 1 : 0;

  const warmupStatusMessage =
    isWaitingForWarmup && warmupMessage && warmupRetryCount > 0
      ? warmupRemainingSeconds === null
        ? `${warmupMessage} Retry #${warmupRetryCount} scheduled.`
        : warmupRemainingSeconds > 0
        ? `${warmupMessage} Retry #${warmupRetryCount} in ~${warmupRemainingSeconds} second${
            warmupRemainingSeconds === 1 ? "" : "s"
          }…`
        : `${warmupMessage} Retry #${warmupRetryCount} in progress…`
      : null;

  return (
    <div className="layout">
      <div className="toolbar" role="region" aria-label="Theme controls">
        <button
          type="button"
          className="theme-toggle"
          onClick={handleToggleTheme}
          aria-pressed={theme === "dark"}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? "Use light theme" : "Use dark theme"}
        </button>
        {!isSystem ? (
          <button
            type="button"
            className="theme-reset"
            onClick={handleUseSystemTheme}
          >
            Use system theme
          </button>
        ) : null}
      </div>
      <header className="hero">
        <h1>Google Certified Device Checker</h1>
        <p>
          Start typing a brand, marketing name, device code, or model identifier to
          see if the device is Play Protect certified.
        </p>
      </header>

      <section className="card">
        <form
          className="search-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSearch();
            }}
          >
          <div className="form-grid">
          <label className="field">
            <span>Brand</span>
            <input
              value={form.brand}
              onChange={(event) => updateField("brand", event.target.value)}
              placeholder="e.g. Google"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span>Marketing Name</span>
            <input
              value={form.marketingName}
              onChange={(event) => updateField("marketingName", event.target.value)}
              placeholder="e.g. Pixel 9 Pro"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span>Device Code</span>
            <input
              value={form.device}
              onChange={(event) => updateField("device", event.target.value)}
              placeholder="e.g. akita"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span>Model ID</span>
            <input
              value={form.model}
              onChange={(event) => updateField("model", event.target.value)}
              placeholder="e.g. GKWS6"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span>Limit</span>
            <input
              type="number"
              min={1}
              max={500}
              value={form.limit}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue === "") {
                  updateField("limit", "");
                  return;
                }

                const numeric = Number(nextValue);
                if (!Number.isFinite(numeric)) {
                  return;
                }

                const bounded = Math.min(500, Math.max(1, Math.floor(numeric)));
                updateField("limit", String(bounded));
              }}
            />
          </label>
            </div>

            <div className="actions">
              <button type="button" onClick={clearForm} className="secondary">
                Clear
              </button>
              {isUsingCachedResults && (
                <button
                  type="button"
                  onClick={() => {
                    void handleSearchForPage(page, { forceRemote: true });
                  }}
                  className="secondary"
                  disabled={isLoading || isWaitingForWarmup}
                >
                  Refresh from Service
                </button>
              )}
              <button
                type="submit"
                disabled={!canSubmit || isLoading || isWaitingForWarmup}
                className="primary"
              >
                {isWaitingForWarmup
                  ? "Warming up…"
                  : isLoading
                  ? "Searching…"
                  : "Search"}
              </button>
            </div>
          </form>

        {!canSubmit && <p className="hint">Enter at least one filter to run a search.</p>}
        {cacheStatusMessage && <p className="status cache-status">{cacheStatusMessage}</p>}
        {warmupStatusMessage && <p className="status">{warmupStatusMessage}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <header className="card-header">
          <h2>Results</h2>
          {hasRows ? (
            <span>
              Showing {startIndex}–{endIndex} of {results.total_matches} matches
            </span>
          ) : totalMatches > 0 ? (
            <span>Total matches: {results.total_matches}</span>
          ) : null}
        </header>

        {isLoading ? (
          <p className="hint">Loading results…</p>
        ) : hasRows ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Marketing Name</th>
                  <th>Device</th>
                  <th>Model</th>
                </tr>
              </thead>
              <tbody>
                {results.results.map((record) => (
                  <tr key={`${record.device}-${record.model}`}>
                    <td>{record.retail_branding || "—"}</td>
                    <td>{record.marketing_name || "—"}</td>
                    <td>{record.device || "—"}</td>
                    <td>{record.model || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pagination">
              <button
                type="button"
                className="secondary"
                onClick={() => void handleSearchForPage(page - 1)}
                disabled={!canGoPrev || isLoading}
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {Math.max(totalPages, currentPage || 1)}
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() => void handleSearchForPage(page + 1)}
                disabled={!canGoNext || isLoading}
              >
                Next
              </button>
            </div>
          </div>
        ) : results && totalMatches > 0 ? (
          <>
            <p className="hint">No results on this page. Try a different page.</p>
            <div className="pagination">
              <button
                type="button"
                className="secondary"
                onClick={() => void handleSearchForPage(Math.max(1, page - 1))}
                disabled={!canGoPrev || isLoading}
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {Math.max(totalPages, currentPage || 1)}
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() => void handleSearchForPage(page + 1)}
                disabled={!canGoNext || isLoading}
              >
                Next
              </button>
            </div>
          </>
        ) : results ? (
          <p className="hint">No matches found for the current filters.</p>
        ) : (
          <p className="hint">No results yet. Enter a filter above to start.</p>
        )}
      </section>

      <footer className="site-footer">
        <span>
          View the code on {" "}
          <a
            href="https://github.com/KmTempe/google-certified-device-checker"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </span>
        <span>
          Need help? Email {" "}
          <a href="mailto:level7feeders@gmail.com">level7feeders@gmail.com</a>
          .
        </span>
        <span>
          Version {APP_VERSION}
          {apiVersion ? ` • API ${apiVersion}` : ""}
        </span>
      </footer>
    </div>
  );
}

export default App;
