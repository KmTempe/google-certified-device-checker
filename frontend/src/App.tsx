import { useMemo, useState } from "react";
import { lookupDevices, type DeviceLookupResponse } from "./api";

interface FormState {
  brand: string;
  marketingName: string;
  device: string;
  model: string;
  limit: number;
}

const initialFormState: FormState = {
  brand: "",
  marketingName: "",
  device: "",
  model: "",
  limit: 25,
};

function App() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<DeviceLookupResponse | null>(null);

  const canSubmit = useMemo(() => {
    return (
      form.brand.trim() !== "" ||
      form.marketingName.trim() !== "" ||
      form.device.trim() !== "" ||
      form.model.trim() !== ""
    );
  }, [form]);

  async function handleSearch() {
    if (!canSubmit) {
      setError("Enter at least one filter to run a search.");
      setResults(null);
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
        limit: form.limit,
      });
      setResults(data);
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
  }

  function clearForm() {
    setForm(initialFormState);
    setResults(null);
    setError(null);
  }

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
                onChange={(event) =>
                  updateField(
                    "limit",
                    Math.min(500, Math.max(1, Number(event.target.value) || initialFormState.limit))
                  )
                }
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
          {results && (
            <span>
              Showing up to {results.limit} of {results.total_matches} matches
            </span>
          )}
        </header>

        {isLoading ? (
          <p className="hint">Loading results…</p>
        ) : results && results.results.length > 0 ? (
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
          </div>
        ) : (
          <p className="hint">No results yet. Enter a filter above to start.</p>
        )}
      </section>
    </div>
  );
}

export default App;
