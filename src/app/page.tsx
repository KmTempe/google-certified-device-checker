"use client";

import { useState } from "react";

interface DeviceData {
  "Retail Branding": string;
  "Marketing Name": string;
  "Device": string;
  "Model": string;
}

export default function Home() {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<DeviceData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!searchTerm) return;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch(`/api/check?device=${encodeURIComponent(searchTerm)}`);
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setResults(data.results);
      }
    } catch (err) {
      setError("Failed to fetch device data.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-8 font-sans">
      <div className="max-w-3xl mx-auto">
        <header className="mb-12 text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4 bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text text-transparent">
            Google Certified Device Checker
          </h1>
          <p className="text-gray-400 text-lg">
            Verify if your Android device is Google Play Protect certified.
          </p>
        </header>

        <div className="flex flex-col md:flex-row gap-3 mb-10 shadow-lg shadow-blue-900/20">
          <input
            type="text"
            className="flex-1 p-4 rounded-xl bg-gray-900 border border-gray-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all placeholder-gray-600 text-lg"
            placeholder="Enter Device Name, Model, or Brand (e.g. Pixel 7)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            onClick={handleSearch}
            className="px-8 py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-semibold text-lg transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Searching...
              </span>
            ) : 'Search'}
          </button>
        </div>

        {error && (
          <div className="p-4 mb-8 bg-red-900/30 border border-red-800/50 rounded-xl text-red-200 flex items-center gap-3">
            <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            {error}
          </div>
        )}

        {results && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between text-sm text-gray-400 px-2">
              <span>Found {results.length} result{results.length !== 1 && 's'}</span>
              {results.length > 0 && <span className="text-green-400">✓ Certified</span>}
            </div>

            {results.length === 0 ? (
              <div className="p-12 text-center bg-gray-900/50 rounded-2xl border border-gray-800 text-gray-400">
                <p className="text-xl mb-2">No devices found</p>
                <p className="text-sm">Try searching for a different model name or brand.</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {results.map((device, index) => (
                  <div key={index} className="group p-6 bg-gray-900 rounded-2xl border border-gray-800 hover:border-blue-500/50 hover:bg-gray-800/80 transition-all duration-300 shadow-sm hover:shadow-blue-900/10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
                      <div>
                        <span className="block text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Marketing Name</span>
                        <span className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">{device['Marketing Name'] || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="block text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Retail Branding</span>
                        <span className="text-gray-300">{device['Retail Branding']}</span>
                      </div>
                      <div className="md:col-span-2 grid grid-cols-2 gap-4 pt-2 border-t border-gray-800 mt-2">
                        <div>
                          <span className="block text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Model</span>
                          <span className="font-mono text-sm text-blue-300 bg-blue-900/20 px-2 py-1 rounded inline-block">{device['Model']}</span>
                        </div>
                        <div>
                          <span className="block text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Device Code</span>
                          <span className="font-mono text-sm text-purple-300 bg-purple-900/20 px-2 py-1 rounded inline-block">{device['Device']}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
