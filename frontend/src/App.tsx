import { useMemo, useState } from "react";
import {
  DEFAULT_LIMIT,
  lookupDevices,
  type DeviceLookupResponse,
} from "./api";
import {
  generateCacheKey,
  getCachedData,
  setCachedData,
  clearOldCache,
} from "./cache";

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

function App() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<DeviceLookupResponse | null>(null);
  const [page, setPage] = useState(1);

  const canSubmit = useMemo(() => {
    return (
      form.brand.trim() !== "" ||
      form.marketingName.trim() !== "" ||
      form.device.trim() !== "" ||
      form.model.trim() !== ""
    );
  }, [form]);

  async function handleSearch() {
    await handleSearchForPage(1);
  }

  async function handleSearchForPage(requestedPage: number) {
    if (!canSubmit) {
      setError("Enter at least one filter to run a search.");
      setResults(null);
      return;
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

    setIsLoading(true);
    setError(null);

    try {
      const data = await lookupDevices({
        brand: form.brand || undefined,
        marketing_name: form.marketingName || undefined,
        device: form.device || undefined,
        model: form.model || undefined,
        limit: normalizedLimit,
        page: requestedPage,
      });
      
      // Cache the successful response
      setCachedData(cacheKey, data);
      
      setResults(data);
      setPage(data.page);
      setForm((prev) => ({ ...prev, limit: String(normalizedLimit) }));
      
      // Clean up old cache entries periodically
      if (Math.random() < 0.1) {
        clearOldCache();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      setError(message);
      setResults(null);
    } finally {
      setIsLoading(false);
    }
  }

  function updateField<T extends keyof FormState>(key: T, value: FormState[T]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function clearForm() {
    setForm(initialFormState);
    setResults(null);
    setError(null);
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

  return (
    <div className="layout">
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
              <button type="submit" disabled={!canSubmit || isLoading} className="primary">
                {isLoading ? "Searching…" : "Search"}
              </button>
            </div>
          </form>

        {!canSubmit && <p className="hint">Enter at least one filter to run a search.</p>}
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
      </footer>
    </div>
  );
}

export default App;
