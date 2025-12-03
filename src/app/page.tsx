"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Pagination } from "@/components/Pagination";
import { Search, Smartphone, CheckCircle2, AlertCircle, Info, Home as HomeIcon, Github, ExternalLink, X } from "lucide-react";
import pkg from "../../package.json";

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
  const [showInfo, setShowInfo] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Close info popover on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(event.target as Node)) {
        setShowInfo(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = async () => {
    if (!searchTerm) return;

    setLoading(true);
    setError(null);
    setResults(null);
    setCurrentPage(1); // Reset to first page on new search

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

  // Pagination logic
  const paginatedResults = useMemo(() => {
    if (!results) return [];
    const startIndex = (currentPage - 1) * itemsPerPage;
    return results.slice(startIndex, startIndex + itemsPerPage);
  }, [results, currentPage, itemsPerPage]);

  const totalPages = results ? Math.ceil(results.length / itemsPerPage) : 0;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans transition-colors duration-300">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-center mb-12 gap-6">
          <div className="text-center md:text-left">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-primary">
              Google Certified Device Checker
            </h1>
            <p className="text-muted-foreground mt-2">
              Verify Google Play Protect certification status
            </p>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="https://l7feeders.dev"
              className="p-2 rounded-full text-muted-foreground hover:bg-muted hover:text-primary transition-colors"
              title="Go to l7feeders.dev"
            >
              <HomeIcon className="w-5 h-5" />
            </a>

            <div className="relative" ref={infoRef}>
              <button
                onClick={() => setShowInfo(!showInfo)}
                className={`p-2 rounded-full transition-colors ${showInfo ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-primary'}`}
                title="Project Info"
              >
                <Info className="w-5 h-5" />
              </button>

              {showInfo && (
                <div className="fixed right-8 top-8 w-72 bg-card border border-border rounded-xl shadow-xl z-50 p-4 animate-in fade-in zoom-in-95 duration-200">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-semibold text-foreground">About Project</h3>
                    <button onClick={() => setShowInfo(false)} className="text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Version</span>
                      <span className="font-mono bg-muted px-2 py-0.5 rounded text-foreground">{pkg.version}</span>
                    </div>

                    <a
                      href="https://github.com/KmTempe/google-certified-device-checker"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between w-full p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <Github className="w-5 h-5 text-foreground" />
                        <span className="text-sm font-medium text-foreground">View on GitHub</span>
                      </div>
                      <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </a>
                  </div>
                </div>
              )}
            </div>

            <ThemeToggle />
          </div>
        </header>

        {/* Search Section */}
        <div className="bg-card border border-border rounded-2xl p-2 shadow-sm mb-8 max-w-2xl mx-auto md:mx-0">
          <div className="flex items-center gap-2 px-2">
            <Search className="w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              className="flex-1 bg-transparent border-none p-3 focus:outline-none text-foreground placeholder-muted-foreground"
              placeholder="Search by Device Name, Model, or Brand..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button
              onClick={handleSearch}
              className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
              disabled={loading}
            >
              {loading ? 'Searching...' : 'Check Device'}
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-4 mb-8 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* Results Section */}
        {results && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {results.length > 0 ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-foreground font-medium">{results.length}</span> devices found
                  </>
                ) : (
                  <span>No devices found</span>
                )}
              </div>
            </div>

            {results.length === 0 ? (
              <div className="p-16 text-center bg-card rounded-2xl border border-border text-muted-foreground dashed-border">
                <Smartphone className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p className="text-lg font-medium">No results found</p>
                <p className="text-sm">Try adjusting your search terms</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="p-4 font-medium text-muted-foreground">Marketing Name</th>
                        <th className="p-4 font-medium text-muted-foreground">Device Code</th>
                        <th className="p-4 font-medium text-muted-foreground">Model</th>
                        <th className="p-4 font-medium text-muted-foreground">Brand</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {paginatedResults.map((device, index) => (
                        <tr key={index} className="hover:bg-muted/30 transition-colors">
                          <td className="p-4 font-medium text-foreground">{device['Marketing Name'] || <span className="text-muted-foreground italic">N/A</span>}</td>
                          <td className="p-4 font-mono text-xs text-muted-foreground">{device['Device']}</td>
                          <td className="p-4 font-mono text-xs text-primary bg-primary/5 rounded w-fit px-2 py-0.5">{device['Model']}</td>
                          <td className="p-4 text-muted-foreground">{device['Retail Branding']}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="border-t border-border bg-muted/20">
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={setCurrentPage}
                    itemsPerPage={itemsPerPage}
                    onItemsPerPageChange={setItemsPerPage}
                    totalItems={results.length}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
